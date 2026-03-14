from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt

from app.config import settings

ALGORITHM = "HS256"


def create_access_token(user_id: str, role: str, email: str) -> tuple[str, str]:
    jti = str(uuid4())
    expire = datetime.now(UTC) + timedelta(days=settings.jwt_access_token_expire_days)
    payload = {
        "sub": user_id,
        "role": role,
        "email": email,
        "jti": jti,
        "exp": expire,
        "type": "access",
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)
    return token, jti


def create_refresh_token(user_id: str) -> str:
    jti = str(uuid4())
    expire = datetime.now(UTC) + timedelta(days=settings.jwt_refresh_token_expire_days)
    payload = {
        "sub": user_id,
        "jti": jti,
        "exp": expire,
        "type": "refresh",
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])


def get_jti(token: str) -> str:
    payload = decode_token(token)
    return payload["jti"]
