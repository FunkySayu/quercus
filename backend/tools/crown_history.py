"""Année de plantation estimée de chaque couronne LiDAR, d'après les photos aériennes datées.

Utilisé par lidar_crowns.py (étape `--no-history` pour la sauter). Pour chaque millésime :
  1. image téléchargée sur l'emprise (IGN WMS-R en Lambert 93, Esri Wayback en tuiles),
     mise en cache sur disque — ces images ne changent plus ;
  2. Esri seulement : recalage sur la BD ORTHO 2023 par corrélation de phase (les
     orthos IGN partagent le référentiel du LiDAR HD et sont laissées telles quelles :
     un recalage automatique s'y fait piéger par les ombres) ;
  3. détecteur « arbre / sol nu » appris SUR CE MILLÉSIME : positifs = sommets des
     couronnes de >= 15 m en 2024 (arbres presque sûrement anciens), négatifs = points
     tirés sur du sol loin de toute couronne. Une couronne est « présente » si son score
     dépasse le 95e centile du sol nu (5 % de faux positifs). Les grands arbres sont
     notés hors échantillon (validation croisée), pour ne pas les déclarer présents
     d'office.
Année retenue : premier millésime à partir duquel la couronne est présente dans >= 75 %
des millésimes suivants. On en tire un intervalle de plantation : après le dernier
millésime sans l'arbre (`planted_after`, null = avant la première photo), au plus tard
au premier millésime où il apparaît (`planted_by`). Un jeune plant n'est pas visible à
25-50 cm : la plantation réelle peut précéder `planted_after` de quelques années.

Précision constatée au quercitum : bonne à l'échelle d'un îlot de plantation, ±1
millésime à l'arbre près (2014 / 2015 / 2016 mal séparés). Null si jamais détecté
durablement (petits arbres, couronnes à l'ombre).
"""
from __future__ import annotations

import io
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer
from scipy import ndimage as ndi
from skimage.draw import polygon as draw_polygon
from skimage.registration import phase_cross_correlation
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_predict, cross_val_score

USER_AGENT = "quercus-lidar-crowns/1.0"
RES = 0.25  # m/pixel
TO_L93 = Transformer.from_crs(4326, 2154, always_xy=True)
TO_WGS = Transformer.from_crs(2154, 4326, always_xy=True)

# Millésimes couvrant le quercitum (dates : cf. web/src/app/pages/home/base-layers.ts).
# (id, année, source, couche WMS-R ou n° de release Wayback)
LAYERS = [
    ("ign1958", 1958, "wms", "ORTHOIMAGERY.ORTHOPHOTOS.1950-1965"),
    ("ign1969", 1969, "wms", "ORTHOIMAGERY.ORTHOPHOTOS.1965-1980"),
    ("ign2002", 2002, "wms", "ORTHOIMAGERY.ORTHOPHOTOS2002"),
    ("ign2007", 2007, "wms", "ORTHOIMAGERY.ORTHOPHOTOS2007"),
    ("ign2011", 2011, "wms", "ORTHOIMAGERY.ORTHOPHOTOS2011"),
    ("esri2013", 2013, "esri", 6678),
    ("ign2014", 2014, "wms", "ORTHOIMAGERY.ORTHOPHOTOS2014"),
    ("esri2015", 2015, "esri", 13045),
    ("esri2016", 2016, "esri", 48376),
    ("ign2017", 2017, "wms", "ORTHOIMAGERY.ORTHOPHOTOS2017"),
    ("ign2020", 2020, "wms", "ORTHOIMAGERY.ORTHOPHOTOS2020"),
    ("ign2023", 2023, "wms", "ORTHOIMAGERY.ORTHOPHOTOS2023"),
]
REFERENCE_LAYER = "ign2023"

OLD_TREE_HEIGHT = 15.0   # m : couronnes servant d'exemples positifs
BARE_DISTANCE = 4.5      # m : un point de sol nu est à au moins cette distance d'une couronne
FALSE_POSITIVE_RATE = 0.05
PERSISTENCE = 0.75


def _get(url: str, attempts: int = 6) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except (TimeoutError, urllib.error.URLError, ConnectionError) as exc:
            retryable = not isinstance(exc, urllib.error.HTTPError) or exc.code == 429 or exc.code >= 500
            if not retryable or attempt == attempts:
                raise
            print(f"  échec ({exc}), nouvelle tentative {attempt + 1}/{attempts}…")
            time.sleep(10 * attempt)
    raise AssertionError("unreachable")


class _Grid:
    def __init__(self, bbox_l93):
        self.x0, self.y0, self.x1, self.y1 = bbox_l93
        self.w = int(round((self.x1 - self.x0) / RES))
        self.h = int(round((self.y1 - self.y0) / RES))

    def to_px(self, x, y):
        return (self.y1 - np.asarray(y)) / RES, (np.asarray(x) - self.x0) / RES


def _fetch_wms(grid: _Grid, layer: str) -> np.ndarray:
    out = np.zeros((grid.h, grid.w, 3), np.uint8)
    for r0 in range(0, grid.h, 512):  # WMS-R limite la taille des images : par bandes
        r1 = min(r0 + 512, grid.h)
        params = {
            "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": layer, "STYLES": "",
            "FORMAT": "image/png", "CRS": "EPSG:2154", "WIDTH": grid.w, "HEIGHT": r1 - r0,
            "BBOX": f"{grid.x0},{grid.y1 - r1 * RES},{grid.x1},{grid.y1 - r0 * RES}",
        }
        body = _get("https://data.geopf.fr/wms-r?" + urllib.parse.urlencode(params))
        if not body.startswith(b"\x89PNG"):
            raise RuntimeError(f"{layer} : le WMS n'a pas renvoyé d'image : {body[:300]!r}")
        out[r0:r1] = np.asarray(Image.open(io.BytesIO(body)).convert("RGB"))
    return out


def _fetch_esri(grid: _Grid, release: int, z: int = 19) -> np.ndarray:
    n = 2 ** z

    def merc(lon, lat):
        lat = np.radians(lat)
        return ((np.asarray(lon) + 180) / 360 * n * 256,
                (1 - np.log(np.tan(lat) + 1 / np.cos(lat)) / math.pi) / 2 * n * 256)

    cx = grid.x0 + (np.arange(grid.w) + 0.5) * RES
    cy = grid.y1 - (np.arange(grid.h) + 0.5) * RES
    mx, my = merc(*TO_WGS.transform(*np.meshgrid(cx, cy)))
    tx0, tx1, ty0, ty1 = int(mx.min() // 256), int(mx.max() // 256), int(my.min() // 256), int(my.max() // 256)
    mosaic = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256, 3), np.uint8)
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            url = ("https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/"
                   f"default028mm/MapServer/tile/{release}/{z}/{ty}/{tx}")
            tile = np.asarray(Image.open(io.BytesIO(_get(url))).convert("RGB"))
            mosaic[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = tile
    coords = [my - ty0 * 256 - 0.5, mx - tx0 * 256 - 0.5]
    return np.stack([ndi.map_coordinates(mosaic[..., b].astype(np.float32), coords, order=1)
                     for b in range(3)], -1).clip(0, 255).astype(np.uint8)


def _load_layer(grid: _Grid, layer_id: str, source: str, ref, cache: Path) -> np.ndarray:
    path = cache / f"{layer_id}_{grid.x0}_{grid.y0}_{grid.x1}_{grid.y1}_{RES}.npy"
    if not path.exists():
        print(f"  téléchargement {layer_id}…")
        img = _fetch_wms(grid, ref) if source == "wms" else _fetch_esri(grid, ref)
        np.save(path, img)
    return np.load(path).astype(np.float32)


def _highpass_lum(img: np.ndarray) -> np.ndarray:
    lum = img.mean(2)
    return lum - ndi.gaussian_filter(lum, 20 / RES)


def _patch_features(img: np.ndarray, rows: np.ndarray, cols: np.ndarray) -> np.ndarray:
    """Descripteurs multi-échelles (luminance, chromaticité, texture) aux points donnés."""
    lum = img.mean(2)
    total = img.sum(2) + 1
    smooth = lambda a, sigma_m: ndi.gaussian_filter(a, sigma_m / RES)
    gradient = np.hypot(ndi.sobel(lum, 0), ndi.sobel(lum, 1))
    maps = [
        smooth(lum, 0.75), smooth(lum, 2),
        smooth(img[..., 0] / total, 1), smooth(img[..., 1] / total, 1),
        smooth(gradient, 1),
        np.sqrt(np.maximum(smooth(lum ** 2, 1) - smooth(lum, 1) ** 2, 0)),
        smooth(lum, 0.75) - smooth(lum, 4),
    ]
    return np.stack([m[rows, cols] for m in maps], 1)


def estimate_planting(bbox_l93, crowns: list[dict], cache: Path) -> tuple[list[dict], dict]:
    """Intervalle de plantation par couronne (même ordre que `crowns`) + métadonnées."""
    cache.mkdir(parents=True, exist_ok=True)
    grid = _Grid(bbox_l93)
    n = len(crowns)
    height = np.array([c["properties"]["height_m"] for c in crowns])
    tops = np.array([TO_L93.transform(*c["properties"]["top"]) for c in crowns])
    top_r, top_c = grid.to_px(tops[:, 0], tops[:, 1])
    top_r = np.clip(np.round(top_r).astype(int), 0, grid.h - 1)
    top_c = np.clip(np.round(top_c).astype(int), 0, grid.w - 1)

    canopy = np.zeros((grid.h, grid.w), bool)
    for c in crowns:
        ring = np.asarray(c["geometry"]["coordinates"][0])
        rr, cc = draw_polygon(*grid.to_px(*TO_L93.transform(ring[:, 0], ring[:, 1])), canopy.shape)
        canopy[rr, cc] = True
    bare = ndi.distance_transform_edt(~canopy) * RES > BARE_DISTANCE
    bare_r, bare_c = np.nonzero(bare)
    pick = np.random.default_rng(0).choice(len(bare_r), size=min(3000, len(bare_r)), replace=False)
    bare_r, bare_c = bare_r[pick], bare_c[pick]

    old = height >= OLD_TREE_HEIGHT
    if old.sum() < 20 or len(bare_r) < 200:
        print("  historique : trop peu de grands arbres ou de sol nu dans l'emprise, étape sautée")
        return [{"planted_after": None, "planted_by": None} for _ in crowns], {}

    reference = _load_layer(grid, REFERENCE_LAYER, "wms", dict((l[0], l[3]) for l in LAYERS)[REFERENCE_LAYER], cache)
    present = np.zeros((n, len(LAYERS)), bool)
    detector_auc = {}
    for k, (layer_id, year, source, ref) in enumerate(LAYERS):
        img = reference if layer_id == REFERENCE_LAYER else _load_layer(grid, layer_id, source, ref, cache)
        if source == "esri":
            shift, _, _ = phase_cross_correlation(_highpass_lum(reference), _highpass_lum(img),
                                                  upsample_factor=4, normalization=None)
            if np.hypot(*shift) * RES <= 10:
                img = ndi.shift(img, (*shift, 0), order=1, mode="nearest")
        f_crowns = _patch_features(img, top_r, top_c)
        f_bare = _patch_features(img, bare_r, bare_c)
        x_train = np.vstack([f_crowns[old], f_bare])
        y_train = np.r_[np.ones(old.sum()), np.zeros(len(f_bare))]
        clf = HistGradientBoostingClassifier(max_iter=150, learning_rate=0.1, class_weight="balanced", random_state=0)
        folds = StratifiedKFold(5, shuffle=True, random_state=0)
        detector_auc[str(year)] = round(float(cross_val_score(clf, x_train, y_train, cv=folds, scoring="roc_auc").mean()), 3)
        # Scores hors échantillon pour les exemples d'apprentissage (grands arbres, sol nu).
        oof = cross_val_predict(clf, x_train, y_train, cv=folds, method="predict_proba")[:, 1]
        clf.fit(x_train, y_train)
        score = clf.predict_proba(f_crowns)[:, 1]
        score[old] = oof[:old.sum()]
        threshold = np.percentile(oof[old.sum():], 100 * (1 - FALSE_POSITIVE_RATE))
        present[:, k] = score > threshold
        print(f"  {year} : détecteur AUC {detector_auc[str(year)]:.2f}, {present[:, k].mean():.0%} des couronnes visibles")

    years = [l[1] for l in LAYERS]
    out = []
    for i in range(n):
        first = next((k for k in range(len(years)) if present[i, k:].mean() >= PERSISTENCE), None)
        if first is None:
            out.append({"planted_after": None, "planted_by": None})
        else:
            out.append({"planted_after": years[first - 1] if first else None, "planted_by": years[first]})
    meta = {
        "method": "première photo datée où la couronne apparaît durablement (détecteur appris par millésime)",
        "years": years,
        "detector_auc": detector_auc,
    }
    return out, meta
