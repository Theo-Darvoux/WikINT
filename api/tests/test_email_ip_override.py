from unittest.mock import AsyncMock, patch

import pytest

from app.core.email import send_email
from app.models.auth_config import AuthConfig


@pytest.mark.asyncio
async def test_send_email_with_ip_override() -> None:
    # Mock aiosmtplib.send
    with patch("aiosmtplib.send", new_callable=AsyncMock) as mock_send:
        config = AuthConfig(
            smtp_host="mail.example.com",
            smtp_ip="1.2.3.4",
            smtp_port=587,
            smtp_user="user",
            smtp_password="password",
            smtp_from="admin@example.com",
            smtp_use_tls=True
        )

        await send_email(
            to="test@test.com",
            subject="Test",
            body="Test body",
            config=config
        )

        # Verify that hostname is set to IP, but server_hostname should be set to host
        mock_send.assert_called_once()
        args, kwargs = mock_send.call_args

        assert kwargs["hostname"] == "1.2.3.4"
        # Currently, it likely doesn't have server_hostname, which causes the SSL error
        # This test will fail if we want to ensure server_hostname is present and correct
        assert kwargs.get("server_hostname") == "mail.example.com"

@pytest.mark.asyncio
async def test_send_email_without_ip_override() -> None:
    with patch("aiosmtplib.send", new_callable=AsyncMock) as mock_send:
        config = AuthConfig(
            smtp_host="mail.example.com",
            smtp_ip=None,
            smtp_port=587,
            smtp_user="user",
            smtp_password="password",
            smtp_from="admin@example.com",
            smtp_use_tls=True
        )

        await send_email(
            to="test@test.com",
            subject="Test",
            body="Test body",
            config=config
        )

        mock_send.assert_called_once()
        args, kwargs = mock_send.call_args

        assert kwargs["hostname"] == "mail.example.com"
        # server_hostname can be None or mail.example.com, but hostname is already correct
