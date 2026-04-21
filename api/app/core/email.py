from typing import Any, cast

import aiosmtplib

from app.config import settings
from app.models.auth_config import AuthConfig


async def send_email(
    to: str,
    subject: str,
    body: str,
    config: AuthConfig | None = None,
) -> None:
    # Use config from DB if provided, fallback to settings from .env
    host = (config.smtp_host if config and config.smtp_host else settings.smtp_host)
    port = (config.smtp_port if config and config.smtp_port else settings.smtp_port)
    user = (config.smtp_user if config and config.smtp_user else settings.smtp_user)
    password = (config.smtp_password if config and config.smtp_password else settings.smtp_password)
    from_email = (config.smtp_from if config and config.smtp_from else settings.smtp_from)
    use_tls = (config.smtp_use_tls if config and config.smtp_use_tls is not None else settings.smtp_use_tls)

    kwargs = {
        "hostname": host,
        "port": port,
        "sender": from_email,
        "recipients": [to],
    }
    if user:
        kwargs["username"] = user
    if password:
        kwargs["password"] = password

    if use_tls:
        if port == 587:
            kwargs["start_tls"] = True
            kwargs["use_tls"] = False
        else:
            kwargs["use_tls"] = True
            kwargs["start_tls"] = False
    else:
        kwargs["use_tls"] = False
        kwargs["start_tls"] = False

    await aiosmtplib.send(_build_message(to, subject, body, from_email), **cast(Any, kwargs))


def _build_message(to: str, subject: str, body: str, from_email: str) -> str:
    return (
        f"From: {from_email}\r\n"
        f"To: {to}\r\n"
        f"Subject: {subject}\r\n"
        f"Content-Type: text/html; charset=utf-8\r\n"
        f"\r\n"
        f"{body}"
    )
