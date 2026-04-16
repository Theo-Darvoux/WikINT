from pydantic import BaseModel, Field, field_validator

_ALLOWED_DOMAINS = ("@telecom-sudparis.eu", "@imt-bs.eu")

# OTP codes are 8 alphanumeric uppercase chars (alphabet excludes I, O, 1, 0)
_OTP_PATTERN = r"^[A-Z2-9]{8}$"
# Magic tokens are base64url – arbitrary length but capped for safety
_MAGIC_TOKEN_MAX = 128


def _validate_school_email(v: str) -> str:
    v = v.strip().lower()
    if len(v) > 254:
        raise ValueError("Email too long")
    if "+" in v:
        raise ValueError("Email aliases with '+' are not allowed")
    if not any(v.endswith(d) for d in _ALLOWED_DOMAINS):
        raise ValueError("Only @telecom-sudparis.eu and @imt-bs.eu emails are allowed")
    return v


class RequestCodeIn(BaseModel):
    email: str = Field(..., max_length=254)

    @field_validator("email")
    @classmethod
    def validate_email_domain(cls, v: str) -> str:
        return _validate_school_email(v)


class VerifyCodeIn(BaseModel):
    email: str = Field(..., max_length=254)
    code: str = Field(..., min_length=8, max_length=8, pattern=_OTP_PATTERN)

    @field_validator("email")
    @classmethod
    def validate_email_domain(cls, v: str) -> str:
        return _validate_school_email(v)


class VerifyMagicLinkIn(BaseModel):
    token: str = Field(..., min_length=1, max_length=_MAGIC_TOKEN_MAX)


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
