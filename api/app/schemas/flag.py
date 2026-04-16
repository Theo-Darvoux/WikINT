import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.core.sanitization import SanitizedStr


class FlagCreateIn(BaseModel):
    target_type: str = Field(pattern=r"^(material|annotation|pull_request|comment|pr_comment)$")
    target_id: uuid.UUID
    reason: str = Field(pattern=r"^(inappropriate|copyright|spam|incorrect|other)$")
    description: SanitizedStr | None = Field(None, max_length=1000)


class FlagUpdateIn(BaseModel):
    status: str = Field(pattern=r"^(resolved|dismissed)$")


class FlagReporter(BaseModel):
    id: uuid.UUID
    display_name: str | None
    email: str

    model_config = {"from_attributes": True}


class FlagOut(BaseModel):
    id: uuid.UUID
    reporter_id: uuid.UUID | None
    reporter: FlagReporter | None = None
    target_type: str
    target_id: uuid.UUID
    reason: str
    description: str | None
    status: str
    resolved_by: uuid.UUID | None
    resolved_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}
