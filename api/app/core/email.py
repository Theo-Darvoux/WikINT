from email.message import EmailMessage
from typing import Any

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
    ip = (config.smtp_ip if config and config.smtp_ip else settings.smtp_ip)
    port = (config.smtp_port if config and config.smtp_port else settings.smtp_port)
    user = (config.smtp_user if config and config.smtp_user else settings.smtp_user)
    password = (config.smtp_password if config and config.smtp_password else settings.smtp_password)
    from_email = (config.smtp_from if config and config.smtp_from else settings.smtp_from)
    use_tls = (config.smtp_use_tls if config and config.smtp_use_tls is not None else settings.smtp_use_tls)

    # Build the message
    message = EmailMessage()
    message["From"] = from_email
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body, subtype="html")

    # Connect to the SMTP server
    # Note: we connect to the IP if provided, but verify the certificate against the host.
    smtp = aiosmtplib.SMTP(
        hostname=ip or host,
        port=port,
        use_tls=use_tls and port != 587,
        start_tls=False,  # Handle STARTTLS manually to provide server_hostname
    )

    try:
        await smtp.connect(server_hostname=host if ip else None)

        if use_tls and port == 587:
            await smtp.starttls(server_hostname=host if ip else None)

        if user and password:
            await smtp.login(user, password)

        await smtp.send_message(message)
    finally:
        try:
            await smtp.close()  # Use close() for safer termination
        except Exception:
            pass
