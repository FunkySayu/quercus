from typing import List

from fastapi import APIRouter, Depends, HTTPException, Response

from ..auth import require_user
from ..models import Tree, TreeCreate
from .. import storage

router = APIRouter(prefix="/api/trees", tags=["trees"])


@router.get("", response_model=List[Tree])
def list_trees() -> List[Tree]:
    return storage.list_trees()


@router.post("", response_model=Tree, status_code=201)
def create_tree(payload: TreeCreate, user: dict = Depends(require_user)) -> Tree:
    return storage.append_tree(payload)


@router.delete("/{tree_id}", status_code=204)
def delete_tree(tree_id: str, user: dict = Depends(require_user)) -> Response:
    """Supprime un relevé : sert à annuler une attribution faite à la peinture sur la carte."""
    if not storage.delete_tree(tree_id):
        raise HTTPException(status_code=404, detail="Relevé inconnu.")
    return Response(status_code=204)
