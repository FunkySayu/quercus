from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator


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
