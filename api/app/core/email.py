import aiosmtplib

from app.config import settings


async def send_email(to: str, subject: str, body: str) -> None:
    kwargs = {
        "hostname": settings.smtp_host,
        "port": settings.smtp_port,
        "sender": settings.smtp_from,
        "recipients": [to],
    }
    if settings.smtp_user:
        kwargs["username"] = settings.smtp_user
    if settings.smtp_password:
        kwargs["password"] = settings.smtp_password

    if settings.smtp_use_tls:
        if settings.smtp_port == 587:
            kwargs["start_tls"] = True
            kwargs["use_tls"] = False
        else:
            kwargs["use_tls"] = True
            kwargs["start_tls"] = False
    else:
        kwargs["use_tls"] = False
        kwargs["start_tls"] = False

    await aiosmtplib.send(
        _build_message(to, subject, body),
        **kwargs
    )


def _build_message(to: str, subject: str, body: str) -> str:
    return (
        f"From: {settings.smtp_from}\r\n"
        f"To: {to}\r\n"
        f"Subject: {subject}\r\n"
        f"Content-Type: text/html; charset=utf-8\r\n"
        f"\r\n"
        f"{body}"
    )
