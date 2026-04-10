import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator


class OnboardIn(BaseModel):
    display_name: str
    academic_year: str
    gdpr_consent: bool

    @field_validator("academic_year")
    @classmethod
    def validate_academic_year(cls, v: str) -> str:
        if v not in ("1A", "2A", "3A+"):
            raise ValueError("academic_year must be one of: 1A, 2A, 3A+")
        return v


class UserUpdateIn(BaseModel):
    display_name: str | None = None
    bio: str | None = None
    academic_year: str | None = None
    avatar_url: str | None = None
    auto_approve: bool | None = None


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str | None
    avatar_url: str | None
    role: str
    bio: str | None
    academic_year: str | None
    onboarded: bool
    auto_approve: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UserProfileOut(UserOut):
    prs_approved: int = 0
    prs_total: int = 0
    annotations_count: int = 0
    comments_count: int = 0
    open_pr_count: int = 0
    reputation: int = 0
