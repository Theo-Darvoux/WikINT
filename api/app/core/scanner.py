import asyncio
import hashlib
import logging
from pathlib import Path

import httpx
import yara

from app.config import settings
from app.core.exceptions import BadRequestError, ServiceUnavailableError

logger = logging.getLogger("wikint")

_rules: yara.Rules | None = None
_http_client: httpx.AsyncClient | None = None


def init_scanner() -> None:
    """Compile YARA rules from disk at startup. Fails hard if no rules found."""
    global _rules, _http_client

    rules_dir = Path(settings.yara_rules_dir)
    if not rules_dir.is_dir():
        raise RuntimeError(f"YARA rules directory not found: {rules_dir}")

    rule_files = {
        f.stem: str(f)
        for f in sorted(rules_dir.rglob("*"))
        if f.suffix in (".yar", ".yara") and f.is_file()
    }

    if not rule_files:
        raise RuntimeError(f"No YARA rule files (*.yar, *.yara) found in {rules_dir}")

    _rules = yara.compile(filepaths=rule_files)
    _http_client = httpx.AsyncClient(timeout=settings.malwarebazaar_timeout)
    logger.info("Scanner: compiled %d YARA rule file(s) from %s", len(rule_files), rules_dir)


async def close_scanner() -> None:
    """Shut down the shared HTTP client."""
    global _http_client
    if _http_client:
        await _http_client.aclose()
        _http_client = None


async def scan_file(file_bytes: bytes, filename: str) -> None:
    """Run YARA + MalwareBazaar scans concurrently. Raises on threat or scanner failure.

    Fail-closed: if either scanner encounters an error, the file is rejected.
    """
    sha256 = hashlib.sha256(file_bytes).hexdigest()

    yara_result, bazaar_result = await asyncio.gather(
        _scan_yara(file_bytes, filename),
        _check_malwarebazaar(sha256, filename),
        return_exceptions=True,
    )

    # Check for exceptions first (fail-closed)
    errors = []
    if isinstance(yara_result, Exception):
        logger.error("YARA scan failed for %s: %s", filename, yara_result)
        errors.append("YARA")
    if isinstance(bazaar_result, Exception):
        logger.error("MalwareBazaar lookup failed for %s: %s", filename, bazaar_result)
        errors.append("MalwareBazaar")

    if errors:
        raise ServiceUnavailableError("Malware scan unavailable — file rejected (fail-closed)")

    # Check for detections — log all before raising
    threats = []
    if yara_result is not None:
        threats.append(("YARA", yara_result))
    if bazaar_result is not None:
        threats.append(("MalwareBazaar", bazaar_result))

    if threats:
        for source, threat in threats:
            logger.warning("Malware detected in %s by %s: %s", filename, source, threat)
        raise BadRequestError("File failed malware scan")


async def _scan_yara(file_bytes: bytes, filename: str) -> str | None:
    """Match file against compiled YARA rules. Runs in thread executor (CPU-bound).

    Returns the first matching rule name, or None if clean.
    """
    if _rules is None:
        raise RuntimeError("Scanner not initialized — call init_scanner() first")

    loop = asyncio.get_running_loop()
    matches = await asyncio.wait_for(
        loop.run_in_executor(
            None,
            lambda: _rules.match(data=file_bytes, timeout=settings.yara_scan_timeout),
        ),
        timeout=settings.yara_scan_timeout + 5,
    )

    if matches:
        rule_names = [m.rule for m in matches]
        logger.warning("YARA match in %s: %s", filename, ", ".join(rule_names))
        return rule_names[0]
    return None


async def _check_malwarebazaar(sha256: str, filename: str) -> str | None:
    """Query MalwareBazaar for known malware by SHA-256 hash.

    Returns threat name if known malware, None if hash not found.
    Raises on timeout or API error (fail-closed).
    """
    if _http_client is None:
        raise RuntimeError("Scanner not initialized — call init_scanner() first")

    try:
        resp = await _http_client.post(
            settings.malwarebazaar_url,
            data={"query": "get_info", "hash": sha256},
        )
    except httpx.TimeoutException:
        raise ServiceUnavailableError(
            "MalwareBazaar lookup timed out — file rejected (fail-closed)"
        )
    except httpx.HTTPError as e:
        raise ServiceUnavailableError(
            f"MalwareBazaar lookup failed: {e} — file rejected (fail-closed)"
        )

    if resp.status_code != 200:
        raise ServiceUnavailableError(
            f"MalwareBazaar returned HTTP {resp.status_code} — file rejected (fail-closed)"
        )

    try:
        body = resp.json()
    except (ValueError, TypeError):
        raise ServiceUnavailableError(
            "MalwareBazaar returned invalid JSON — file rejected (fail-closed)"
        )

    status = body.get("query_status")

    if status in ("hash_not_found", "no_results"):
        return None

    if status == "ok":
        # Known malware — extract signature name
        data = body.get("data", [{}])
        if isinstance(data, list) and data:
            threat = data[0].get("signature") or data[0].get("file_name", "unknown")
        else:
            threat = "known malware"
        logger.warning("MalwareBazaar hit for %s (sha256=%s): %s", filename, sha256, threat)
        return threat

    # Unexpected status — fail closed
    raise ServiceUnavailableError(
        f"MalwareBazaar unexpected status '{status}' — file rejected (fail-closed)"
    )
