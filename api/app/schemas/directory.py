import uuid
from datetime import datetime

from pydantic import AliasChoices, BaseModel, Field


class DirectoryOut(BaseModel):
    id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    slug: str
    type: str
    description: str | None
    metadata: dict = Field(validation_alias=AliasChoices("metadata_", "metadata"))
    sort_order: int
    is_system: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class DirectoryWithCounts(DirectoryOut):
    child_directory_count: int = 0
    child_material_count: int = 0


class DirectoryBreadcrumb(BaseModel):
    id: uuid.UUID
    name: str
    slug: str

    model_config = {"from_attributes": True}
