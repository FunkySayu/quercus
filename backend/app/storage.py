import csv
import os
import re
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .models import Species, Tree, TreeCreate

CSV_PATH = Path(os.environ.get("CSV_PATH", "/data/trees.csv"))
FIELDNAMES = ["id", "latitude", "longitude", "accuracy", "reference", "name", "created_at"]

SPECIES_SEED_PATH = Path(__file__).parent / "data" / "species_seed.csv"
SPECIES_CSV_PATH = Path(os.environ.get("SPECIES_CSV_PATH", "/data/species.csv"))
SPECIES_FIELDNAMES = [
    "reference",
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

# Fiche « Quercus sp. (à identifier) » : ses relevés et sa fiche restent dans les CSV
# (données de terrain) mais ne sont jamais servis.
PLACEHOLDER_REFERENCE = "0"

_lock = threading.Lock()
_species_lock = threading.Lock()


def _ensure_file() -> None:
    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not CSV_PATH.exists():
        with CSV_PATH.open("w", newline="", encoding="utf-8") as handle:
            csv.DictWriter(handle, fieldnames=FIELDNAMES).writeheader()


def append_tree(payload: TreeCreate) -> Tree:
    species = get_or_create_species(payload.reference, payload.name)

    tree = Tree(
        id=str(uuid.uuid4()),
        created_at=datetime.now(timezone.utc).isoformat(),
        latitude=payload.latitude,
        longitude=payload.longitude,
        accuracy=payload.accuracy,
        reference=species.reference,
        name=payload.name,
        nom_scientifique=species.nom_scientifique or None,
        nom_usage=species.nom_usage or None,
        origine=species.origine or None,
        statut_uicn=species.statut_uicn or None,
        statut_uicn_annee=species.statut_uicn_annee or None,
        statut_uicn_url=species.statut_uicn_url or None,
        wikipedia_url=species.wikipedia_url or None,
        powo_url=species.powo_url or None,
        description=species.description or None,
        continent=species.continent or None,
    )

    with _lock:
        _ensure_file()
        with CSV_PATH.open("a", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDNAMES)
            writer.writerow(
                {
                    "id": tree.id,
                    "latitude": tree.latitude,
                    "longitude": tree.longitude,
                    "accuracy": tree.accuracy,
                    "reference": tree.reference or "",
                    "name": tree.name or "",
                    "created_at": tree.created_at,
                }
            )

    return tree


def delete_tree(tree_id: str) -> bool:
    """Retire un relevé de trees.csv (annulation d'une attribution faite depuis la carte).

    Réécriture atomique ligne à ligne, les autres relevés restent intacts. False si inconnu.
    """
    with _lock:
        _ensure_file()
        with CSV_PATH.open("r", newline="", encoding="utf-8") as handle:
            rows = list(csv.DictReader(handle))
        kept = [row for row in rows if row["id"] != tree_id]
        if len(kept) == len(rows):
            return False
        tmp = CSV_PATH.with_suffix(CSV_PATH.suffix + ".tmp")
        with tmp.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDNAMES)
            writer.writeheader()
            writer.writerows(kept)
        tmp.replace(CSV_PATH)
        return True


def list_trees() -> List[Tree]:
    with _lock:
        _ensure_file()
        with CSV_PATH.open("r", newline="", encoding="utf-8") as handle:
            rows = list(csv.DictReader(handle))

    species_by_reference = _species_map()

    trees = []
    for row in rows:
        reference = row["reference"] or None
        if reference and reference.strip() == PLACEHOLDER_REFERENCE:
            continue
        species = species_by_reference.get(reference.strip().lower()) if reference else None
        trees.append(
            Tree(
                id=row["id"],
                latitude=float(row["latitude"]),
                longitude=float(row["longitude"]),
                accuracy=float(row["accuracy"]),
                reference=reference,
                name=row["name"] or None,
                created_at=row["created_at"],
                nom_scientifique=(species.nom_scientifique or None) if species else None,
                nom_usage=(species.nom_usage or None) if species else None,
                origine=(species.origine or None) if species else None,
                statut_uicn=(species.statut_uicn or None) if species else None,
                statut_uicn_annee=(species.statut_uicn_annee or None) if species else None,
                statut_uicn_url=(species.statut_uicn_url or None) if species else None,
                wikipedia_url=(species.wikipedia_url or None) if species else None,
                powo_url=(species.powo_url or None) if species else None,
                description=(species.description or None) if species else None,
                continent=(species.continent or None) if species else None,
            )
        )
    trees.sort(key=lambda tree: tree.created_at, reverse=True)
    return trees


def _ensure_species_file() -> None:
    SPECIES_CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not SPECIES_CSV_PATH.exists():
        if SPECIES_SEED_PATH.exists():
            shutil.copyfile(SPECIES_SEED_PATH, SPECIES_CSV_PATH)
        else:
            with SPECIES_CSV_PATH.open("w", newline="", encoding="utf-8") as handle:
                csv.DictWriter(handle, fieldnames=SPECIES_FIELDNAMES).writeheader()


def _read_species_unlocked() -> List[Species]:
    _ensure_species_file()
    with SPECIES_CSV_PATH.open("r", newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    return [Species(**row) for row in rows]


def _append_species_unlocked(species: Species) -> None:
    with SPECIES_CSV_PATH.open("a", newline="", encoding="utf-8") as handle:
        csv.DictWriter(handle, fieldnames=SPECIES_FIELDNAMES).writerow(species.model_dump())


def _species_sort_key(species: Species) -> Tuple[int, int, str]:
    match = re.match(r"^(\d+)\s*(Bis|Ter)?$", species.reference.strip(), re.IGNORECASE)
    if not match:
        return (10**9, 0, species.reference)
    number = int(match.group(1))
    suffix_rank = {"BIS": 1, "TER": 2}.get((match.group(2) or "").upper(), 0)
    return (number, suffix_rank, "")


def _next_reference(species_list: List[Species]) -> str:
    max_number = 0
    for species in species_list:
        match = re.match(r"^(\d+)", species.reference.strip())
        if match:
            max_number = max(max_number, int(match.group(1)))
    return str(max_number + 1)


def _species_map() -> Dict[str, Species]:
    return {species.reference.strip().lower(): species for species in list_species()}


def list_species() -> List[Species]:
    with _species_lock:
        species_list = _read_species_unlocked()
    visible = [species for species in species_list if species.reference.strip() != PLACEHOLDER_REFERENCE]
    return sorted(visible, key=_species_sort_key)


def get_or_create_species(reference: Optional[str], name: Optional[str]) -> Species:
    """Résout un couple (référence, nom) vers une entrée du catalogue quercitum.

    Une référence connue ou un nom (scientifique / d'usage) déjà catalogué
    réutilise l'entrée existante. Une référence inconnue crée une fiche pour
    ce numéro ; un nom seul sans correspondance se voit attribuer le
    prochain numéro de référence disponible.
    """
    with _species_lock:
        species_list = _read_species_unlocked()
        by_reference = {species.reference.strip().lower(): species for species in species_list}

        if reference:
            key = reference.strip().lower()
            existing = by_reference.get(key)
            if existing:
                return existing
            new_species = Species(reference=reference.strip(), nom_usage=(name or "").strip())
            _append_species_unlocked(new_species)
            return new_species

        name_key = (name or "").strip().lower()
        for species in species_list:
            if (
                species.nom_scientifique.strip().lower() == name_key
                or species.nom_usage.strip().lower() == name_key
            ):
                return species

        new_species = Species(reference=_next_reference(species_list), nom_usage=(name or "").strip())
        _append_species_unlocked(new_species)
        return new_species
