import uuid
from datetime import datetime

from pydantic import AliasChoices, BaseModel, Field, field_validator

from app.models.security import VirusScanResult


class MaterialVersionOut(BaseModel):
    id: uuid.UUID
    material_id: uuid.UUID
    version_number: int
    file_key: str | None
    file_name: str | None
    file_size: int | None
    file_mime_type: str | None
    diff_summary: str | None
    author_id: uuid.UUID | None
    pr_id: uuid.UUID | None
    virus_scan_result: VirusScanResult
    created_at: datetime

    model_config = {"from_attributes": True}


class MaterialOut(BaseModel):
    id: uuid.UUID
    directory_id: uuid.UUID
    directory_path: str | None = None
    title: str
    slug: str
    description: str | None
    type: str
    current_version: int
    parent_material_id: uuid.UUID | None
    author_id: uuid.UUID | None
    metadata: dict = Field(validation_alias=AliasChoices("metadata_", "metadata"))
    download_count: int
    attachment_count: int = 0
    tags: list[str] = []
    created_at: datetime
    updated_at: datetime

    @field_validator("tags", mode="before")
    @classmethod
    def extract_tag_names(cls, v: list | None) -> list[str]:
        if not v:
            return []
        return [tag.name if hasattr(tag, "name") else str(tag) for tag in v]

    model_config = {"from_attributes": True}


class MaterialDetail(MaterialOut):
    current_version_info: MaterialVersionOut | None = None


class UploadCompleteOut(BaseModel):
    file_key: str
    size: int
    mime_type: str
