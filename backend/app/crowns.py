"""Fusion couronnes LiDAR + relevés GPS → un objet "couronne" par arbre pour l'UI.

L'UI ne raisonne plus en pins (un par relevé) mais en couronnes : chaque arbre est
un polygone, soit sa couronne LiDAR (lidar_crowns.geojson) quand un relevé y a été
rattaché par tools/lidar_crowns.py, soit un cercle de `GPS_CIRCLE_DIAMETER_M` centré
sur le relevé quand aucune couronne ne lui correspond de façon fiable (relevé
`unmatched`, ou relevé saisi après le dernier lancement du script).

Les rattachements viennent de lidar_readings.geojson (figé au lancement du script),
mais les fiches (référence, espèce) sont relues EN DIRECT dans trees.csv /
species.csv : une correction de référence ou un nouveau relevé est visible
immédiatement, sans relancer le traitement LiDAR.

Couronnes masquées : une couronne qu'on ne veut pas suivre (haie, arbre hors
collection, faux positif) n'est jamais supprimée du GeoJSON, elle y porte
`hidden: true` (+ `hidden_by` / `hidden_at`), posé par `set_crown_hidden`. Elle est
filtrée pour les visiteurs, et renvoyée (marquée) aux utilisateurs connectés pour
pouvoir être restaurée. Ses éventuels relevés retombent en cercles GPS.
tools/lidar_crowns.py reporte ces marqueurs lors d'une régénération.
"""
from __future__ import annotations

import json
import math
import os
import threading
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from . import storage
from .models import Tree

# Fichiers produits hors-ligne par tools/lidar_crowns.py, par défaut à côté de trees.csv.
LIDAR_DIR = Path(os.environ.get("LIDAR_DIR", storage.CSV_PATH.parent))

# Rattachements retenus comme "fiables" : relevé dans la couronne, ou affecté à la
# couronne voisine par l'appariement un-pour-un du script. `unmatched` → cercle GPS.
IDENTIFIED_MATCHES = {"inside", "snapped"}

GPS_CIRCLE_DIAMETER_M = 2.0
GPS_CIRCLE_VERTICES = 24
EARTH_RADIUS_M = 6_371_008.8

_SPECIES_FIELDS = [
    "nom_scientifique",
    "nom_usage",
    "origine",
    "statut_uicn",
    "statut_uicn_annee",
    "statut_uicn_url",
    "wikipedia_url",
    "powo_url",
    "description",
    "continent",
]

_cache_lock = threading.Lock()
# Sérialise les écritures de marqueurs (lecture-modification-écriture du GeoJSON).
_write_lock = threading.Lock()
_cache: Dict[Path, Tuple[int, Optional[dict]]] = {}


def lidar_path(name: str) -> Path:
    return LIDAR_DIR / f"lidar_{name}.geojson"


def _load_geojson(path: Path) -> Optional[dict]:
    """Lit un GeoJSON, mis en cache tant que son mtime ne change pas (~1 Mo de couronnes)."""
    try:
        mtime = path.stat().st_mtime_ns
    except FileNotFoundError:
        return None
    with _cache_lock:
        cached = _cache.get(path)
        if cached and cached[0] == mtime:
            return cached[1]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = None
    with _cache_lock:
        _cache[path] = (mtime, data)
    return data


def _write_geojson(path: Path, data: dict) -> None:
    # Écriture atomique, même format compact que tools/lidar_crowns.py.
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def set_crown_hidden(crown_id: int, hidden: bool, user: Optional[dict] = None) -> bool:
    """Pose (ou retire) le marqueur `hidden` d'une couronne. False si elle n'existe pas."""
    path = lidar_path("crowns")
    with _write_lock:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return False
        for feature in data.get("features", []):
            props = feature.setdefault("properties", {})
            if props.get("crown_id") != crown_id:
                continue
            if hidden:
                props["hidden"] = True
                props["hidden_by"] = (user or {}).get("email") or (user or {}).get("name")
                props["hidden_at"] = datetime.now(timezone.utc).isoformat()
            else:
                for key in ("hidden", "hidden_by", "hidden_at"):
                    props.pop(key, None)
            _write_geojson(path, data)
            return True
    return False


def gps_circle(longitude: float, latitude: float, diameter_m: float = GPS_CIRCLE_DIAMETER_M) -> dict:
    """Polygone circulaire autour d'un point (approximation locale, largement suffisante à 1 m)."""
    radius = diameter_m / 2
    d_lat = math.degrees(radius / EARTH_RADIUS_M)
    d_lon = d_lat / max(math.cos(math.radians(latitude)), 1e-6)
    ring = []
    for i in range(GPS_CIRCLE_VERTICES):
        angle = 2 * math.pi * i / GPS_CIRCLE_VERTICES
        ring.append([round(longitude + d_lon * math.cos(angle), 8), round(latitude + d_lat * math.sin(angle), 8)])
    ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [ring]}


def _species_payload(tree: Tree) -> Dict[str, Optional[str]]:
    return {field: getattr(tree, field) for field in _SPECIES_FIELDS}


def _reading_payload(tree: Tree, link: Optional[dict]) -> Dict[str, Any]:
    return {
        "id": tree.id,
        "latitude": tree.latitude,
        "longitude": tree.longitude,
        "accuracy": tree.accuracy,
        "reference": tree.reference,
        "name": tree.name,
        "created_at": tree.created_at,
        "match": link.get("match") if link else None,
        "dist_to_top_m": link.get("dist_to_top_m") if link else None,
    }


def _feature(feature_id: str, geometry: dict, crown: Optional[dict], trees: List[Tree], links: Dict[str, dict]) -> dict:
    crown = crown or {}
    first = trees[0] if trees else None
    readings = sorted(trees, key=lambda tree: tree.created_at, reverse=True)
    top = crown.get("top") or ([first.longitude, first.latitude] if first else None)
    return {
        "type": "Feature",
        "id": feature_id,
        "geometry": geometry,
        "properties": {
            "id": feature_id,
            "source": "lidar" if crown else "gps",
            "crown_id": crown.get("crown_id"),
            "height_m": crown.get("height_m"),
            "diameter_m": crown.get("diameter_m", GPS_CIRCLE_DIAMETER_M if not crown else None),
            "area_m2": crown.get("area_m2"),
            "planted_after": crown.get("planted_after"),
            "planted_by": crown.get("planted_by"),
            "top": top,
            "reference": first.reference if first else None,
            "name": first.name if first else None,
            **(_species_payload(first) if first else {field: None for field in _SPECIES_FIELDS}),
            "hidden": bool(crown.get("hidden")),
            "readings": [_reading_payload(tree, links.get(tree.id)) for tree in readings],
        },
    }


def build_crowns(include_hidden: bool = False) -> dict:
    """FeatureCollection de toutes les couronnes (identifiées ou non) + cercles GPS.

    `include_hidden` : renvoie aussi les couronnes masquées (marquées `hidden`), pour
    les utilisateurs connectés ; sinon elles sont filtrées.
    """
    crowns_fc = _load_geojson(lidar_path("crowns")) or {}
    readings_fc = _load_geojson(lidar_path("readings")) or {}

    crowns_by_id: Dict[int, dict] = {}
    hidden_crowns: List[dict] = []
    for feature in crowns_fc.get("features", []):
        props = feature.get("properties") or {}
        if props.get("crown_id") is None:
            continue
        if props.get("hidden"):
            # Absente de crowns_by_id : ses relevés éventuels retombent en cercles GPS.
            hidden_crowns.append(feature)
        else:
            crowns_by_id[props["crown_id"]] = feature

    links: Dict[str, dict] = {}
    for feature in readings_fc.get("features", []):
        props = feature.get("properties") or {}
        if props.get("tree_id"):
            links[props["tree_id"]] = props

    trees_by_crown: Dict[int, List[Tree]] = {}
    loose_trees: List[Tree] = []
    for tree in storage.list_trees():
        link = links.get(tree.id)
        crown_id = link.get("crown_id") if link else None
        if link and link.get("match") in IDENTIFIED_MATCHES and crown_id in crowns_by_id:
            trees_by_crown.setdefault(crown_id, []).append(tree)
        else:
            loose_trees.append(tree)

    features = []
    for crown_id, crown_feature in crowns_by_id.items():
        trees = trees_by_crown.get(crown_id, [])
        if trees:
            # Le script garantit une seule fiche par couronne, mais la référence est relue
            # en direct : si elle a divergé depuis, la fiche majoritaire garde la couronne
            # et les autres relevés retombent en cercles GPS plutôt que d'être mélangés.
            majority, _ = Counter(tree.reference for tree in trees).most_common(1)[0]
            loose_trees.extend(tree for tree in trees if tree.reference != majority)
            trees = [tree for tree in trees if tree.reference == majority]
        features.append(
            _feature(f"crown-{crown_id}", crown_feature["geometry"], crown_feature.get("properties"), trees, links)
        )

    if include_hidden:
        for crown_feature in hidden_crowns:
            props = crown_feature.get("properties") or {}
            features.append(_feature(f"crown-{props['crown_id']}", crown_feature["geometry"], props, [], links))

    for tree in loose_trees:
        features.append(_feature(f"tree-{tree.id}", gps_circle(tree.longitude, tree.latitude), None, [tree], links))

    return {"type": "FeatureCollection", "metadata": crowns_fc.get("metadata"), "features": features}
