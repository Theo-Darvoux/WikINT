from pydantic import BaseModel, field_validator


class RequestCodeIn(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def validate_email_domain(cls, v: str) -> str:
        v = v.strip().lower()
        if "+" in v:
            raise ValueError("Email aliases with '+' are not allowed")
        allowed_domains = ("@telecom-sudparis.eu", "@imt-bs.eu")
        if not any(v.endswith(d) for d in allowed_domains):
            raise ValueError("Only @telecom-sudparis.eu and @imt-bs.eu emails are allowed")
        return v


class VerifyCodeIn(BaseModel):
    email: str
    code: str


class TokenResponse(BaseModel):
    access_token: str
    user: "UserBrief"
    is_new_user: bool


class RefreshResponse(BaseModel):
    access_token: str


class UserBrief(BaseModel):
    id: str
    email: str
    display_name: str | None
    avatar_url: str | None
    role: str
    onboarded: bool

    model_config = {"from_attributes": True}
