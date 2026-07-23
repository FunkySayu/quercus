from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class Species(BaseModel):
    reference: str
    nom_scientifique: str = ""
    nom_usage: str = ""
    origine: str = ""
    statut_uicn: str = ""
    wikipedia_url: str = ""
    description: str = ""


class TreeCreate(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy: float = Field(ge=0)
    reference: Optional[str] = None
    name: Optional[str] = None

    @field_validator("reference", "name")
    @classmethod
    def blank_to_none(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @model_validator(mode="after")
    def require_reference_or_name(self) -> "TreeCreate":
        if not self.reference and not self.name:
            raise ValueError("Un numéro de référence ou un nom est requis.")
        return self


class Tree(TreeCreate):
    id: str
    created_at: str
    nom_scientifique: Optional[str] = None
    nom_usage: Optional[str] = None
    origine: Optional[str] = None
    statut_uicn: Optional[str] = None
    wikipedia_url: Optional[str] = None
    description: Optional[str] = None
