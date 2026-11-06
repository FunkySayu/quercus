import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from .. import storage

# Fichiers produits hors-ligne par tools/lidar_crowns.py (couronnes LiDAR + rattachement
# des relevés) : lidar_crowns.geojson / lidar_readings.geojson, par défaut à côté de
# trees.csv dans le volume de données.
LIDAR_DIR = Path(os.environ.get("LIDAR_DIR", storage.CSV_PATH.parent))

router = APIRouter(prefix="/api/lidar", tags=["lidar"])


def _serve(name: str) -> FileResponse:
    path = LIDAR_DIR / f"lidar_{name}.geojson"
    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Couronnes LiDAR non générées (lancer backend/tools/lidar_crowns.py).",
        )
    # FileResponse pose ETag / Last-Modified : le navigateur revalide sans tout retélécharger.
    return FileResponse(path, media_type="application/geo+json")


@router.get("/crowns")
def crowns() -> FileResponse:
    return _serve("crowns")


@router.get("/readings")
def readings() -> FileResponse:
    return _serve("readings")
