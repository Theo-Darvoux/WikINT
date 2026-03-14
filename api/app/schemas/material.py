import uuid
from datetime import datetime

from pydantic import AliasChoices, BaseModel, Field


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
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MaterialDetail(MaterialOut):
    current_version_info: MaterialVersionOut | None = None


class UploadRequestIn(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)
    size: int = Field(..., ge=0, le=1_073_741_824)
    mime_type: str = Field(..., max_length=200)


class UploadRequestOut(BaseModel):
    upload_url: str
    file_key: str
    mime_type: str


class UploadCompleteIn(BaseModel):
    file_key: str


class UploadCompleteOut(BaseModel):
    file_key: str
    size: int
    mime_type: str
