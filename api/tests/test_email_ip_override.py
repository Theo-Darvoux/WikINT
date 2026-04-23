from unittest.mock import AsyncMock, patch
import pytest
from app.core.email import send_email
from app.models.auth_config import AuthConfig


@pytest.mark.asyncio
async def test_send_email_with_ip_override() -> None:
    # Mock aiosmtplib.SMTP
    with patch("aiosmtplib.SMTP", autospec=True) as mock_smtp_class:
        mock_smtp = mock_smtp_class.return_value
        mock_smtp.connect = AsyncMock()
        mock_smtp.starttls = AsyncMock()
        mock_smtp.login = AsyncMock()
        mock_smtp.send_message = AsyncMock()
        mock_smtp.close = AsyncMock()
        # Mocking __aenter__ and __aexit__ for async with support
        mock_smtp.__aenter__ = AsyncMock(return_value=mock_smtp)
        mock_smtp.__aexit__ = AsyncMock()

        config = AuthConfig(
            smtp_host="mail.example.com",
            smtp_ip="1.2.3.4",
            smtp_port=587,
            smtp_user="user",
            smtp_password="password",
            smtp_from="noreply@example.com",
            smtp_use_tls=True,
        )

        await send_email("to@example.com", "Subject", "Body", config=config)

        # SMTP should be initialized with the IP
        mock_smtp_class.assert_called_once()
        args, kwargs = mock_smtp_class.call_args
        assert kwargs["hostname"] == "1.2.3.4"
        assert kwargs["port"] == 587
        assert kwargs["use_tls"] is False  # False because port is 587 (STARTTLS)
        assert kwargs["start_tls"] is False # We handle it manually

        # connect and starttls should be called with the original host for SSL verification
        mock_smtp.connect.assert_called_once_with(server_hostname="mail.example.com")
        mock_smtp.starttls.assert_called_once_with(server_hostname="mail.example.com")
        mock_smtp.send_message.assert_called_once()


@pytest.mark.asyncio
async def test_send_email_without_ip_override() -> None:
    with patch("aiosmtplib.SMTP", autospec=True) as mock_smtp_class:
        mock_smtp = mock_smtp_class.return_value
        mock_smtp.connect = AsyncMock()
        mock_smtp.starttls = AsyncMock()
        mock_smtp.login = AsyncMock()
        mock_smtp.send_message = AsyncMock()
        mock_smtp.close = AsyncMock()

        config = AuthConfig(
            smtp_host="mail.example.com",
            smtp_ip=None,
            smtp_port=587,
            smtp_user="user",
            smtp_password="password",
            smtp_from="noreply@example.com",
            smtp_use_tls=True,
        )

        await send_email("to@example.com", "Subject", "Body", config=config)

        # SMTP should be initialized with the host
        mock_smtp_class.assert_called_once()
        args, kwargs = mock_smtp_class.call_args
        assert kwargs["hostname"] == "mail.example.com"

        # connect and starttls should NOT have server_hostname override
        mock_smtp.connect.assert_called_once_with(server_hostname=None)
        mock_smtp.starttls.assert_called_once_with(server_hostname=None)
