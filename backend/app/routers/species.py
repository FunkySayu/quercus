from typing import List

from fastapi import APIRouter

from ..models import Species
from .. import storage

router = APIRouter(prefix="/api/species", tags=["species"])


@router.get("", response_model=List[Species])
def list_species() -> List[Species]:
    return storage.list_species()
