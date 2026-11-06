from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response

from .. import crowns
from ..auth import optional_user, require_user

router = APIRouter(prefix="/api/crowns", tags=["crowns"])


@router.get("")
def list_crowns(user: Optional[dict] = Depends(optional_user)) -> dict:
    """Couronnes LiDAR fusionnées avec les relevés (voir app/crowns.py).

    Les couronnes masquées ne sont renvoyées (marquées `hidden`) qu'aux utilisateurs connectés.
    """
    return crowns.build_crowns(include_hidden=user is not None)


def _set_hidden(crown_id: int, hidden: bool, user: dict) -> Response:
    if not crowns.set_crown_hidden(crown_id, hidden, user):
        raise HTTPException(status_code=404, detail="Couronne inconnue.")
    return Response(status_code=204)


@router.delete("/{crown_id}", status_code=204)
def hide_crown(crown_id: int, user: dict = Depends(require_user)) -> Response:
    """Suppression "douce" : marque la couronne `hidden` dans le GeoJSON, sans l'effacer."""
    return _set_hidden(crown_id, True, user)


@router.post("/{crown_id}/restore", status_code=204)
def restore_crown(crown_id: int, user: dict = Depends(require_user)) -> Response:
    return _set_hidden(crown_id, False, user)
