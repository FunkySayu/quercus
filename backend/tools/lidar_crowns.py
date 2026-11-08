"""Détection des couronnes d'arbres sur le LiDAR HD IGN → GeoJSON servi par le backend.

Script hors-ligne (pas exécuté par l'app) : il télécharge le MNH LiDAR HD (modèle
numérique de hauteur, 50 cm) et les emprises de bâtiments BD TOPO autour des relevés,
isole chaque couronne, rattache les relevés GPS aux couronnes, et écrit deux fichiers
dans le dossier de sortie — par défaut celui de trees.csv (`data/`), que lit
`/api/lidar/*` (voir app/routers/lidar.py) :

  lidar_crowns.geojson   une couronne par arbre détecté (Polygon) : hauteur, diamètre,
                   références des relevés rattachés.
  lidar_readings.geojson un point par relevé, avec la couronne retenue et la position du
                   sommet (`snapped_to`), ou `match: "unmatched"`.

Les rattachements reflètent trees.csv AU MOMENT DU LANCEMENT : relancer le script
après une session de terrain pour y inclure les nouveaux relevés. Le script ne fait
que LIRE trees.csv / species.csv.

Pipeline (segmentation classique sur MNH, cf. lidR lmf + Dalponte 2016) :
  1. Bâtiments masqués (le MNH est une hauteur au-dessus du sol : les toits
     deviendraient des arbres), puis léger lissage gaussien.
  2. Sommets = maxima locaux dont la fenêtre de recherche croît avec la hauteur.
  3. Ligne de partage des eaux (watershed) sur le MNH inversé, depuis les sommets.
  4. Fusion des couronnes voisines séparées par un col peu marqué (un grand chêne
     découpé en plusieurs), puis élagage façon Dalponte (hauteur relative, rayon max).
  5. Relevés de même référence à < 5 m regroupés (même arbre pointé deux fois), puis
     affectation un-pour-un aux couronnes (algorithme hongrois) : une couronne ne
     porte jamais deux fiches différentes.
  6. Année de plantation estimée de chaque couronne d'après les photos aériennes
     datées 1958-2023 (voir crown_history.py ; `--no-history` pour sauter l'étape).
     Propriétés `planted_after` / `planted_by` : intervalle entre le dernier millésime
     sans l'arbre et le premier où il apparaît. Les images sont mises en cache
     (`--cache`, défaut data/aerial_cache/) : seul le premier lancement les télécharge.
  7. Couronnes masquées depuis l'app (`hidden`) reportées depuis l'ancien fichier
     (par position du sommet, les numéros n'étant pas stables) : voir carry_over_hidden.

Usage (depuis backend/) :
  python -m venv .venv-tools && .venv-tools/bin/pip install -r tools/requirements.txt
  .venv-tools/bin/python tools/lidar_crowns.py --trees data/trees.csv --species data/species.csv
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import tifffile
from pyproj import Transformer
from scipy import ndimage as ndi
from scipy.optimize import linear_sum_assignment
from skimage.draw import polygon as draw_polygon
from skimage.measure import approximate_polygon, find_contours
from skimage.segmentation import watershed

from crown_history import estimate_planting

USER_AGENT = "quercus-lidar-crowns/1.0"
WMS_R = "https://data.geopf.fr/wms-r"
WFS = "https://data.geopf.fr/wfs/ows"

RES = 0.5  # m/pixel du MNH LiDAR HD

# --- Paramètres de segmentation (mètres) ---------------------------------------
SMOOTH_SIGMA = 0.5        # lissage gaussien
MIN_HEIGHT = 1.5          # en dessous : herbe / buissons
MIN_TOP_HEIGHT = 2.0      # hauteur minimale d'un sommet
CROWN_REL_HEIGHT = 0.35   # Dalponte : pixel gardé s'il fait >= 35 % de la hauteur du sommet
MAX_CROWN_RADIUS = 9.0
MERGE_SADDLE_RATIO = 0.8  # fusion si col >= 80 % du plus petit sommet…
BUILDING_BUFFER = 1.5     # dilatation des emprises de bâtiments
# --- Rattachement des relevés ----------------------------------------------------
MATCH_SLACK = 2.5         # tolérance ajoutée à la précision GPS du relevé
DUPLICATE_RADIUS = 5.0

TO_L93 = Transformer.from_crs(4326, 2154, always_xy=True)
TO_WGS = Transformer.from_crs(2154, 4326, always_xy=True)


# ------------------------------------------------------------------------------
# Téléchargements
# ------------------------------------------------------------------------------
def http_get(url: str, attempts: int = 3) -> bytes:
    """GET avec quelques nouvelles tentatives : la Géoplateforme a des timeouts/502 passagers."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except (TimeoutError, urllib.error.URLError, ConnectionError) as exc:
            if isinstance(exc, urllib.error.HTTPError) and exc.code < 500:
                raise  # erreur de requête : inutile de réessayer
            if attempt == attempts:
                raise
            print(f"  échec ({exc}), nouvelle tentative {attempt + 1}/{attempts}…")
            time.sleep(5 * attempt)
    raise AssertionError("unreachable")


class Grid:
    """Emprise Lambert 93 alignée sur la grille 50 cm du LiDAR HD."""

    def __init__(self, x0: float, y0: float, x1: float, y1: float):
        self.x0, self.y0 = math.floor(x0), math.floor(y0)
        self.x1, self.y1 = math.ceil(x1), math.ceil(y1)
        self.width = int(round((self.x1 - self.x0) / RES))
        self.height = int(round((self.y1 - self.y0) / RES))

    def bbox(self) -> str:
        return f"{self.x0},{self.y0},{self.x1},{self.y1}"

    def world_to_pixel(self, x, y):
        return (self.y1 - np.asarray(y)) / RES, (np.asarray(x) - self.x0) / RES

    def pixel_to_lonlat(self, rows, cols):
        x = self.x0 + (np.asarray(cols) + 0.5) * RES
        y = self.y1 - (np.asarray(rows) + 0.5) * RES
        return TO_WGS.transform(x, y)


def download_chm(grid: Grid) -> np.ndarray:
    if grid.width > 8000 or grid.height > 8000:
        sys.exit(f"Emprise trop grande ({grid.width}x{grid.height} px) : réduire --margin ou --bbox.")
    params = {
        "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "EXCEPTIONS": "text/xml",
        "LAYERS": "IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93", "STYLES": "",
        "FORMAT": "image/geotiff", "CRS": "EPSG:2154", "BBOX": grid.bbox(),
        "WIDTH": grid.width, "HEIGHT": grid.height,
    }
    body = http_get(f"{WMS_R}?{urllib.parse.urlencode(params)}")
    if not body.startswith((b"II*", b"MM\x00*")):
        sys.exit(f"Le WMS LiDAR n'a pas renvoyé de GeoTIFF : {body[:300]!r}")
    chm = tifffile.imread(io.BytesIO(body)).astype(np.float32)
    chm[~np.isfinite(chm) | (chm < 0) | (chm > 80)] = 0  # nodata / valeurs aberrantes
    return chm


def download_buildings(grid: Grid) -> list:
    params = {
        "SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": "BDTOPO_V3:batiment",
        "OUTPUTFORMAT": "application/json", "SRSNAME": "EPSG:2154", "PROPERTYNAME": "geometrie",
        "BBOX": f"{grid.bbox()},urn:ogc:def:crs:EPSG::2154", "COUNT": 5000,
    }
    return json.loads(http_get(f"{WFS}?{urllib.parse.urlencode(params)}"))["features"]


def lidar_acquisition(grid: Grid) -> dict:
    """Mission et dates d'acquisition LiDAR HD de la dalle au centre de l'emprise."""
    lon, lat = TO_WGS.transform((grid.x0 + grid.x1) / 2, (grid.y0 + grid.y1) / 2)
    d = 0.0005
    params = {
        "SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature",
        "TYPENAMES": "IGNF_LIDAR-HD_METADONNEE:metadata", "OUTPUTFORMAT": "application/json", "COUNT": 1,
        "PROPERTYNAME": "code_mission,date_debut_acquisition,date_fin_acquisition",
        "BBOX": f"{lat-d},{lon-d},{lat+d},{lon+d},urn:ogc:def:crs:EPSG::4326",
    }
    try:
        features = json.loads(http_get(f"{WFS}?{urllib.parse.urlencode(params)}"))["features"]
        return features[0]["properties"] if features else {}
    except Exception:  # noqa: BLE001 — métadonnée de confort, pas bloquante
        return {}


# ------------------------------------------------------------------------------
# Segmentation
# ------------------------------------------------------------------------------
def building_mask(grid: Grid, features: list) -> np.ndarray:
    mask = np.zeros((grid.height, grid.width), dtype=bool)
    for feature in features:
        geom = feature["geometry"]
        polygons = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for poly in polygons:
            ring = np.asarray(poly[0])[:, :2]
            rows, cols = grid.world_to_pixel(ring[:, 0], ring[:, 1])
            rr, cc = draw_polygon(rows, cols, mask.shape)
            mask[rr, cc] = True
    return ndi.binary_dilation(mask, iterations=int(round(BUILDING_BUFFER / RES)))


def window_radius(height_m):
    """Rayon de recherche d'un sommet ≈ rayon de couronne attendu pour sa hauteur."""
    return np.clip(0.6 + 0.12 * height_m, 1.0, 4.5)


def find_tops(chm: np.ndarray):
    cand = (chm == ndi.maximum_filter(chm, size=3)) & (chm >= MIN_TOP_HEIGHT)
    rows, cols = np.nonzero(cand)
    order = np.argsort(-chm[rows, cols])
    h, w = chm.shape
    keep_r, keep_c = [], []
    taken = np.zeros(chm.shape, dtype=bool)  # un seul sommet par plateau
    for r, c in zip(rows[order], cols[order]):
        if taken[r, c]:
            continue
        rad = window_radius(chm[r, c]) / RES
        ri = int(math.ceil(rad))
        r0, r1, c0, c1 = max(r - ri, 0), min(r + ri + 1, h), max(c - ri, 0), min(c + ri + 1, w)
        yy, xx = np.ogrid[r0 - r:r1 - r, c0 - c:c1 - c]
        disk = yy * yy + xx * xx <= rad * rad
        window = chm[r0:r1, c0:c1]
        if chm[r, c] >= window[disk].max():
            keep_r.append(r)
            keep_c.append(c)
            taken[r0:r1, c0:c1] |= disk & (window >= chm[r, c] - 1e-3)
    return np.array(keep_r, dtype=int), np.array(keep_c, dtype=int)


def merge_oversegmented(chm, labels, tops_r, tops_c):
    """Fusionne les couronnes adjacentes séparées par un col peu marqué."""
    n = len(tops_r)
    top_h = chm[tops_r, tops_c]
    saddle: dict = {}
    for a_lab, b_lab, a_h, b_h in (
        (labels[:, :-1], labels[:, 1:], chm[:, :-1], chm[:, 1:]),
        (labels[:-1, :], labels[1:, :], chm[:-1, :], chm[1:, :]),
    ):
        edge = (a_lab != b_lab) & (a_lab > 0) & (b_lab > 0)
        la, lb = a_lab[edge], b_lab[edge]
        heights = np.minimum(a_h[edge], b_h[edge])
        for x, y, v in zip(np.minimum(la, lb), np.maximum(la, lb), heights):
            if v > saddle.get((x, y), -1):
                saddle[(x, y)] = v
    parent = np.arange(n + 1)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for (a, b), v in sorted(saddle.items(), key=lambda kv: -kv[1]):
        ra, rb = find(a), find(b)
        if ra == rb:
            continue
        ha, hb = top_h[ra - 1], top_h[rb - 1]
        dist = math.hypot(tops_r[ra - 1] - tops_r[rb - 1], tops_c[ra - 1] - tops_c[rb - 1]) * RES
        if v >= MERGE_SADDLE_RATIO * min(ha, hb) and dist <= 0.3 * max(ha, hb) + 1.0:
            keep, drop = (ra, rb) if ha >= hb else (rb, ra)
            parent[drop] = keep
    roots = np.array([find(i) for i in range(n + 1)])
    uniq = np.unique(roots[1:])
    remap = np.zeros(n + 1, dtype=np.int32)
    remap[uniq] = np.arange(1, len(uniq) + 1)
    merged = remap[roots][labels]
    merged[labels == 0] = 0
    return merged, tops_r[uniq - 1], tops_c[uniq - 1]


def segment(chm: np.ndarray):
    tops_r, tops_c = find_tops(chm)
    markers = np.zeros(chm.shape, dtype=np.int32)
    markers[tops_r, tops_c] = np.arange(1, len(tops_r) + 1)
    labels = watershed(-chm, markers, mask=chm >= MIN_HEIGHT)
    labels, tops_r, tops_c = merge_oversegmented(chm, labels, tops_r, tops_c)

    top_h = np.concatenate([[0], chm[tops_r, tops_c]])
    tr = np.concatenate([[0], tops_r])
    tc = np.concatenate([[0], tops_c])
    rr, cc = np.indices(chm.shape)
    dist = np.hypot(rr - tr[labels], cc - tc[labels]) * RES
    labels[(labels > 0) & ((chm < CROWN_REL_HEIGHT * top_h[labels]) | (dist > MAX_CROWN_RADIUS))] = 0
    return labels, tops_r, tops_c


# ------------------------------------------------------------------------------
# Relevés
# ------------------------------------------------------------------------------
def load_readings(trees_csv: Path, species_csv: Path | None) -> list[dict]:
    species = {}
    if species_csv and species_csv.exists():
        with species_csv.open(encoding="utf-8") as handle:
            species = {row["reference"]: row for row in csv.DictReader(handle)}
    readings = []
    with trees_csv.open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row.get("reference", "").strip() == "0":
                continue  # Fiche « à identifier » : conservée dans le CSV, ignorée partout ailleurs.
            try:
                lon, lat, accuracy = float(row["longitude"]), float(row["latitude"]), float(row["accuracy"])
            except (KeyError, ValueError):
                continue
            x, y = TO_L93.transform(lon, lat)
            sp = species.get(row.get("reference", ""), {})
            readings.append({
                "id": row["id"], "reference": row.get("reference", ""),
                "name": sp.get("nom_scientifique") or row.get("name", ""),
                "accuracy": accuracy, "lon": lon, "lat": lat, "x": x, "y": y,
            })
    return readings


def match_readings(readings, grid: Grid, labels, tops_r, tops_c):
    """Regroupe les doublons puis affecte les groupes aux couronnes un pour un."""
    h, w = labels.shape
    for rd in readings:
        rd["row"], rd["col"] = (float(v) for v in grid.world_to_pixel(rd["x"], rd["y"]))
    groups: list[list[dict]] = []
    for rd in readings:
        for group in groups:
            same_ref = group[0]["reference"] == rd["reference"] and rd["reference"] != ""
            if same_ref and min(math.hypot(rd["x"] - o["x"], rd["y"] - o["y"]) for o in group) <= DUPLICATE_RADIUS:
                group.append(rd)
                break
        else:
            groups.append([rd])

    big = 1e9
    cost = np.full((len(groups), len(tops_r)), big)
    for gi, group in enumerate(groups):
        gr = np.mean([o["row"] for o in group])
        gc = np.mean([o["col"] for o in group])
        d = np.hypot(tops_r - gr, tops_c - gc) * RES
        ok = d <= min(o["accuracy"] for o in group) + MATCH_SLACK
        cost[gi, ok] = d[ok]
        r, c = int(round(gr)), int(round(gc))
        if 0 <= r < h and 0 <= c < w and labels[r, c]:
            cost[gi, labels[r, c] - 1] = d[labels[r, c] - 1] * 0.5  # dans une couronne : fort a priori
    assigned = {}
    if len(groups) and len(tops_r):
        rows, cols = linear_sum_assignment(cost)
        assigned = {int(g): int(c) for g, c in zip(rows, cols) if cost[g, c] < big}

    for gi, group in enumerate(groups):
        for rd in group:
            d_tops = np.hypot(tops_r - rd["row"], tops_c - rd["col"]) * RES
            if gi in assigned:
                ci = assigned[gi]
                r, c = int(round(rd["row"])), int(round(rd["col"]))
                inside = 0 <= r < h and 0 <= c < w and labels[r, c] == ci + 1
                rd.update(crown=ci + 1, match="inside" if inside else "snapped", dist=float(d_tops[ci]))
            else:
                rd.update(crown=None, match="unmatched", dist=float(d_tops.min()) if len(d_tops) else None)


# ------------------------------------------------------------------------------
# GeoJSON
# ------------------------------------------------------------------------------
def crown_ring(mask: np.ndarray):
    contours = find_contours(np.pad(mask, 1).astype(float), 0.5)
    if not contours:
        return None
    ring = approximate_polygon(max(contours, key=len) - 1, tolerance=0.35)  # ~17 cm
    return ring if len(ring) >= 4 else None


def build_geojson(grid: Grid, chm_raw, labels, tops_r, tops_c, readings, meta):
    n = len(tops_r)
    ids = np.arange(1, n + 1)
    area = ndi.sum(np.ones_like(labels, dtype=float), labels, ids) * RES * RES
    height = chm_raw[tops_r, tops_c]
    tops_lon, tops_lat = grid.pixel_to_lonlat(tops_r, tops_c)

    by_crown: dict[int, list] = {}
    for rd in readings:
        if rd["crown"]:
            by_crown.setdefault(rd["crown"], []).append(rd)

    crowns = []
    for i, sl in enumerate(ndi.find_objects(labels), start=1):
        if sl is None:
            continue
        ring = crown_ring(labels[sl] == i)
        if ring is None:
            continue
        lon, lat = grid.pixel_to_lonlat(ring[:, 0] + sl[0].start, ring[:, 1] + sl[1].start)
        coords = [[round(a, 7), round(b, 7)] for a, b in zip(lon, lat)]
        if coords[0] != coords[-1]:
            coords.append(coords[0])
        matched = by_crown.get(i, [])
        refs = sorted({m["reference"] for m in matched})
        crowns.append({
            "type": "Feature",
            "id": i,
            "geometry": {"type": "Polygon", "coordinates": [coords]},
            "properties": {
                "crown_id": i,
                "height_m": round(float(height[i - 1]), 1),
                "area_m2": round(float(area[i - 1]), 1),
                "diameter_m": round(2 * math.sqrt(area[i - 1] / math.pi), 1),
                "top": [round(float(tops_lon[i - 1]), 7), round(float(tops_lat[i - 1]), 7)],
                "n_readings": len(matched),
                "references": refs,
            },
        })

    points = []
    for rd in readings:
        snapped = None
        if rd["crown"]:
            ci = rd["crown"] - 1
            snapped = [round(float(tops_lon[ci]), 7), round(float(tops_lat[ci]), 7)]
        points.append({
            "type": "Feature",
            "id": rd["id"],
            "geometry": {"type": "Point", "coordinates": [rd["lon"], rd["lat"]]},
            "properties": {
                "tree_id": rd["id"], "reference": rd["reference"], "name": rd["name"],
                "accuracy": rd["accuracy"], "crown_id": rd["crown"], "match": rd["match"],
                "dist_to_top_m": None if rd["dist"] is None else round(rd["dist"], 1),
                "snapped_to": snapped,
            },
        })
    # `metadata` : membre étranger GeoJSON (RFC 7946 §6.1), ignoré par Leaflet.
    return (
        {"type": "FeatureCollection", "metadata": meta, "features": crowns},
        {"type": "FeatureCollection", "metadata": meta, "features": points},
    )


HIDDEN_KEYS = ("hidden", "hidden_by", "hidden_at")


def _point_in_ring(lon: float, lat: float, ring: list) -> bool:
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > lat) != (y2 > lat) and lon < x1 + (lat - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def carry_over_hidden(previous: Path, crowns_fc: dict) -> int:
    """Reporte les couronnes masquées depuis l'app (`hidden`, voir backend app/crowns.py).

    Les numéros de couronne ne sont pas stables d'un lancement à l'autre : une nouvelle
    couronne hérite du marqueur si son sommet tombe dans une couronne masquée de
    l'ancien fichier. Renvoie le nombre de couronnes masquées dans le nouveau fichier.
    """
    try:
        old = json.loads(previous.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0
    hidden = []
    for feature in old.get("features", []):
        props = feature.get("properties") or {}
        if props.get("hidden") and feature.get("geometry", {}).get("type") == "Polygon":
            ring = feature["geometry"]["coordinates"][0]
            xs, ys = [p[0] for p in ring], [p[1] for p in ring]
            hidden.append(((min(xs), min(ys), max(xs), max(ys)), ring, props))
    count = 0
    for feature in crowns_fc["features"]:
        lon, lat = feature["properties"]["top"]
        for (x0, y0, x1, y1), ring, props in hidden:
            if x0 <= lon <= x1 and y0 <= lat <= y1 and _point_in_ring(lon, lat, ring):
                feature["properties"].update({k: props[k] for k in HIDDEN_KEYS if k in props})
                count += 1
                break
    return count


def write_json(path: Path, data: dict) -> None:
    # Écriture atomique : le backend peut servir le fichier pendant la régénération.
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # console Windows (cp1252) : accents lisibles
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--trees", type=Path, required=True, help="trees.csv (lu seulement)")
    parser.add_argument("--species", type=Path, help="species.csv, pour les noms (optionnel)")
    parser.add_argument("--out", type=Path, help="dossier de sortie (défaut : celui de trees.csv)")
    parser.add_argument("--margin", type=float, default=40.0, help="marge autour des relevés, en m (défaut 40)")
    parser.add_argument("--bbox", help="emprise WGS84 explicite minlon,minlat,maxlon,maxlat (sinon : relevés + marge)")
    parser.add_argument("--no-history", action="store_true", help="ne pas estimer l'année de plantation")
    parser.add_argument("--cache", type=Path,
                        help="cache des photos aériennes (défaut : aerial_cache/ dans le dossier de sortie)")
    args = parser.parse_args()

    readings = load_readings(args.trees, args.species)
    if args.bbox:
        minlon, minlat, maxlon, maxlat = (float(v) for v in args.bbox.split(","))
        (x0, x1), (y0, y1) = TO_L93.transform([minlon, maxlon], [minlat, maxlat])
        grid = Grid(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
    elif readings:
        xs = [r["x"] for r in readings]
        ys = [r["y"] for r in readings]
        grid = Grid(min(xs) - args.margin, min(ys) - args.margin, max(xs) + args.margin, max(ys) + args.margin)
    else:
        sys.exit("Aucun relevé dans trees.csv : préciser --bbox.")
    print(f"Emprise L93 {grid.bbox()} ({grid.width}x{grid.height} px), {len(readings)} relevés")

    print("Téléchargement du MNH LiDAR HD…")
    chm_raw = download_chm(grid)
    print("Téléchargement des bâtiments BD TOPO…")
    buildings = download_buildings(grid)
    chm_raw[building_mask(grid, buildings)] = 0
    chm = ndi.gaussian_filter(chm_raw, SMOOTH_SIGMA / RES)

    print("Segmentation…")
    labels, tops_r, tops_c = segment(chm)
    match_readings(readings, grid, labels, tops_r, tops_c)

    acquisition = lidar_acquisition(grid)
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "IGN LiDAR HD — MNH 50 cm ; BD TOPO bâtiments",
        "lidar_mission": acquisition.get("code_mission"),
        "lidar_acquired": acquisition.get("date_debut_acquisition", "").rstrip("Z") or None,
        "bbox_l93": [grid.x0, grid.y0, grid.x1, grid.y1],
        "readings_count": len(readings),
    }
    crowns_fc, readings_fc = build_geojson(grid, chm_raw, labels, tops_r, tops_c, readings, meta)

    if not args.no_history:
        print("Année de plantation (photos aériennes datées)…")
        cache = args.cache or (args.out or args.trees.parent) / "aerial_cache"
        planting, planting_meta = estimate_planting(meta["bbox_l93"], crowns_fc["features"], cache)
        for feature, estimate in zip(crowns_fc["features"], planting):
            feature["properties"].update(estimate)
        meta["planting"] = planting_meta

    out = args.out or args.trees.parent
    out.mkdir(parents=True, exist_ok=True)
    n_hidden = carry_over_hidden(out / "lidar_crowns.geojson", crowns_fc)
    write_json(out / "lidar_crowns.geojson", crowns_fc)
    write_json(out / "lidar_readings.geojson", readings_fc)

    matches = [r["match"] for r in readings]
    print(f"{len(crowns_fc['features'])} couronnes ; relevés : {matches.count('inside')} dans une couronne, "
          f"{matches.count('snapped')} rattachés, {matches.count('unmatched')} sans couronne")
    if not args.no_history:
        dated = sum(1 for f in crowns_fc["features"] if f["properties"].get("planted_by"))
        print(f"Année de plantation estimée pour {dated}/{len(crowns_fc['features'])} couronnes")
    if n_hidden:
        print(f"{n_hidden} couronnes masquées reportées depuis le fichier précédent")
    print(f"Écrit dans {out}")


if __name__ == "__main__":
    main()
