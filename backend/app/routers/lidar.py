from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from .. import crowns

# Fichiers bruts produits hors-ligne par tools/lidar_crowns.py (couronnes LiDAR +
# rattachement des relevés), servis tels quels. L'UI s'appuie sur /api/crowns (fusion
# couronnes + relevés, voir app/crowns.py) ; /readings sert au calque de diagnostic.

router = APIRouter(prefix="/api/lidar", tags=["lidar"])


def _serve(name: str) -> FileResponse:
    path = crowns.lidar_path(name)
    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Couronnes LiDAR non générées (lancer backend/tools/lidar_crowns.py).",
        )
    # FileResponse pose ETag / Last-Modified : le navigateur revalide sans tout retélécharger.
    return FileResponse(path, media_type="application/geo+json")


@router.get("/crowns")
def crowns_file() -> FileResponse:
    return _serve("crowns")


@router.get("/readings")
def readings() -> FileResponse:
    return _serve("readings")
