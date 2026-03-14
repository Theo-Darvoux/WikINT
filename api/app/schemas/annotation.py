from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, Field

StrFromUUID = Annotated[str, BeforeValidator(lambda v: str(v))]
OptStrFromUUID = Annotated[str | None, BeforeValidator(lambda v: str(v) if v is not None else None)]


class AnnotationAuthor(BaseModel):
    id: StrFromUUID
    display_name: str | None
    avatar_url: str | None

    model_config = {"from_attributes": True}


class AnnotationCreateIn(BaseModel):
    body: str = Field(min_length=1, max_length=1000)
    selection_text: str | None = None
    position_data: dict | None = None
    page: int | None = None
    reply_to_id: str | None = None


class AnnotationUpdateIn(BaseModel):
    body: str = Field(min_length=1, max_length=1000)


class AnnotationOut(BaseModel):
    id: StrFromUUID
    material_id: StrFromUUID
    version_id: OptStrFromUUID
    author_id: OptStrFromUUID
    author: AnnotationAuthor | None = None
    body: str
    page: int | None
    selection_text: str | None
    position_data: dict | None
    thread_id: OptStrFromUUID
    reply_to_id: OptStrFromUUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ThreadOut(BaseModel):
    root: AnnotationOut
    replies: list[AnnotationOut]
