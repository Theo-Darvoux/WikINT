from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.core.exceptions import BadRequestError, ServiceUnavailableError
from app.core.scanner import (
    _check_malwarebazaar,
    _scan_yara,
    init_scanner,
    scan_file,
)

# ── YARA tests ──


@patch("app.core.scanner._rules")
async def test_yara_scan_clean(mock_rules: MagicMock) -> None:
    mock_rules.match.return_value = []
    result = await _scan_yara(b"clean file content", "test.pdf")
    assert result is None


@patch("app.core.scanner._rules")
async def test_yara_scan_match(mock_rules: MagicMock) -> None:
    match = MagicMock()
    match.rule = "EICAR_test_file"
    mock_rules.match.return_value = [match]
    result = await _scan_yara(b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR", "test.txt")
    assert result == "EICAR_test_file"


@patch("app.core.scanner._rules")
async def test_yara_scan_multiple_matches_returns_first(mock_rules: MagicMock) -> None:
    match1 = MagicMock()
    match1.rule = "PE_in_non_executable"
    match2 = MagicMock()
    match2.rule = "Embedded_Shellcode_Patterns"
    mock_rules.match.return_value = [match1, match2]
    result = await _scan_yara(b"MZ\x90\x00PE\x00\x00", "test.pdf")
    assert result == "PE_in_non_executable"


async def test_yara_scan_not_initialized() -> None:
    with patch("app.core.scanner._rules", None):
        with pytest.raises(RuntimeError, match="not initialized"):
            await _scan_yara(b"data", "test.pdf")


# ── init_scanner tests ──


def test_init_scanner_missing_dir(tmp_path: object) -> None:
    with patch("app.core.scanner.settings") as mock_settings:
        mock_settings.yara_rules_dir = "/nonexistent/path"
        with pytest.raises(RuntimeError, match="not found"):
            init_scanner()


def test_init_scanner_empty_dir(tmp_path) -> None:
    with patch("app.core.scanner.settings") as mock_settings:
        mock_settings.yara_rules_dir = str(tmp_path)
        with pytest.raises(RuntimeError, match="No YARA rule files"):
            init_scanner()


# ── MalwareBazaar tests ──


@patch("app.core.scanner._http_client")
async def test_hash_lookup_clean(mock_client: MagicMock) -> None:
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"query_status": "hash_not_found"}
    mock_client.post = AsyncMock(return_value=mock_response)

    result = await _check_malwarebazaar("abc123", "test.pdf")
    assert result is None


@patch("app.core.scanner._http_client")
async def test_hash_lookup_no_results(mock_client: MagicMock) -> None:
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"query_status": "no_results"}
    mock_client.post = AsyncMock(return_value=mock_response)

    result = await _check_malwarebazaar("abc123", "test.pdf")
    assert result is None


@patch("app.core.scanner._http_client")
async def test_hash_lookup_found(mock_client: MagicMock) -> None:
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "query_status": "ok",
        "data": [{"signature": "Emotet", "file_name": "malware.exe"}],
    }
    mock_client.post = AsyncMock(return_value=mock_response)

    result = await _check_malwarebazaar("abc123", "test.pdf")
    assert result == "Emotet"


@patch("app.core.scanner._http_client")
async def test_hash_lookup_timeout(mock_client: MagicMock) -> None:
    mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("timed out"))

    with pytest.raises(ServiceUnavailableError, match="timed out"):
        await _check_malwarebazaar("abc123", "test.pdf")


@patch("app.core.scanner._http_client")
async def test_hash_lookup_http_error(mock_client: MagicMock) -> None:
    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_client.post = AsyncMock(return_value=mock_response)

    with pytest.raises(ServiceUnavailableError, match="HTTP 500"):
        await _check_malwarebazaar("abc123", "test.pdf")


@patch("app.core.scanner._http_client")
async def test_hash_lookup_unexpected_status(mock_client: MagicMock) -> None:
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"query_status": "illegal_hash"}
    mock_client.post = AsyncMock(return_value=mock_response)

    with pytest.raises(ServiceUnavailableError, match="unexpected status"):
        await _check_malwarebazaar("abc123", "test.pdf")


@patch("app.core.scanner._http_client")
async def test_hash_lookup_invalid_json(mock_client: MagicMock) -> None:
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.side_effect = ValueError("Invalid JSON")
    mock_client.post = AsyncMock(return_value=mock_response)

    with pytest.raises(ServiceUnavailableError, match="invalid JSON"):
        await _check_malwarebazaar("abc123", "test.pdf")


async def test_hash_lookup_not_initialized() -> None:
    with patch("app.core.scanner._http_client", None):
        with pytest.raises(RuntimeError, match="not initialized"):
            await _check_malwarebazaar("abc123", "test.pdf")


# ── Combined scan tests ──


@patch("app.core.scanner._check_malwarebazaar", new_callable=AsyncMock)
@patch("app.core.scanner._scan_yara", new_callable=AsyncMock)
async def test_combined_scan_both_clean(mock_yara: AsyncMock, mock_bazaar: AsyncMock) -> None:
    mock_yara.return_value = None
    mock_bazaar.return_value = None
    # Should not raise
    await scan_file(b"clean content", "test.pdf")


@patch("app.core.scanner._check_malwarebazaar", new_callable=AsyncMock)
@patch("app.core.scanner._scan_yara", new_callable=AsyncMock)
async def test_combined_scan_yara_positive(mock_yara: AsyncMock, mock_bazaar: AsyncMock) -> None:
    mock_yara.return_value = "EICAR_test_file"
    mock_bazaar.return_value = None
    with pytest.raises(BadRequestError, match="malware scan"):
        await scan_file(b"content", "test.pdf")


@patch("app.core.scanner._check_malwarebazaar", new_callable=AsyncMock)
@patch("app.core.scanner._scan_yara", new_callable=AsyncMock)
async def test_combined_scan_bazaar_positive(mock_yara: AsyncMock, mock_bazaar: AsyncMock) -> None:
    mock_yara.return_value = None
    mock_bazaar.return_value = "Emotet"
    with pytest.raises(BadRequestError, match="malware scan"):
        await scan_file(b"content", "test.pdf")


@patch("app.core.scanner._check_malwarebazaar", new_callable=AsyncMock)
@patch("app.core.scanner._scan_yara", new_callable=AsyncMock)
async def test_combined_scan_both_positive(mock_yara: AsyncMock, mock_bazaar: AsyncMock) -> None:
    mock_yara.return_value = "PE_in_non_executable"
    mock_bazaar.return_value = "Emotet"
    with pytest.raises(BadRequestError, match="malware scan"):
        await scan_file(b"content", "test.pdf")


@patch("app.core.scanner._check_malwarebazaar", new_callable=AsyncMock)
@patch("app.core.scanner._scan_yara", new_callable=AsyncMock)
async def test_combined_scan_yara_error_fails_closed(
    mock_yara: AsyncMock, mock_bazaar: AsyncMock
) -> None:
    mock_yara.side_effect = RuntimeError("YARA crashed")
    mock_bazaar.return_value = None
    with pytest.raises(ServiceUnavailableError, match="fail-closed"):
        await scan_file(b"content", "test.pdf")


@patch("app.core.scanner._check_malwarebazaar", new_callable=AsyncMock)
@patch("app.core.scanner._scan_yara", new_callable=AsyncMock)
async def test_combined_scan_bazaar_error_fails_closed(
    mock_yara: AsyncMock, mock_bazaar: AsyncMock
) -> None:
    mock_yara.return_value = None
    mock_bazaar.side_effect = ServiceUnavailableError("MalwareBazaar down")
    with pytest.raises(ServiceUnavailableError, match="fail-closed"):
        await scan_file(b"content", "test.pdf")


@patch("app.core.scanner._check_malwarebazaar", new_callable=AsyncMock)
@patch("app.core.scanner._scan_yara", new_callable=AsyncMock)
async def test_combined_scan_both_error_fails_closed(
    mock_yara: AsyncMock, mock_bazaar: AsyncMock
) -> None:
    mock_yara.side_effect = RuntimeError("YARA crashed")
    mock_bazaar.side_effect = ServiceUnavailableError("MalwareBazaar down")
    with pytest.raises(ServiceUnavailableError, match="fail-closed"):
        await scan_file(b"content", "test.pdf")
