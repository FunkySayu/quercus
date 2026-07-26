from typing import List

from fastapi import APIRouter, Depends

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
