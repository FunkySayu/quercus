import csv
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from .models import Tree, TreeCreate

CSV_PATH = Path(os.environ.get("CSV_PATH", "/data/trees.csv"))
FIELDNAMES = ["id", "latitude", "longitude", "accuracy", "reference", "name", "created_at"]

_lock = threading.Lock()


def _ensure_file() -> None:
    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not CSV_PATH.exists():
        with CSV_PATH.open("w", newline="", encoding="utf-8") as handle:
            csv.DictWriter(handle, fieldnames=FIELDNAMES).writeheader()


def append_tree(payload: TreeCreate) -> Tree:
    tree = Tree(
        id=str(uuid.uuid4()),
        created_at=datetime.now(timezone.utc).isoformat(),
        **payload.model_dump(),
    )

    with _lock:
        _ensure_file()
        with CSV_PATH.open("a", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDNAMES)
            row = tree.model_dump()
            row["reference"] = row["reference"] or ""
            row["name"] = row["name"] or ""
            writer.writerow(row)

    return tree


def list_trees() -> List[Tree]:
    with _lock:
        _ensure_file()
        with CSV_PATH.open("r", newline="", encoding="utf-8") as handle:
            rows = list(csv.DictReader(handle))

    trees = [
        Tree(
            id=row["id"],
            latitude=float(row["latitude"]),
            longitude=float(row["longitude"]),
            accuracy=float(row["accuracy"]),
            reference=row["reference"] or None,
            name=row["name"] or None,
            created_at=row["created_at"],
        )
        for row in rows
    ]
    trees.sort(key=lambda tree: tree.created_at, reverse=True)
    return trees
