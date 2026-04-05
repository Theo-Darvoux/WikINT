import hashlib
import hmac as _hmac

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.config import settings

_CAS_INFO = b"wikint-cas-v1"


def _derive_cas_signing_key() -> bytes:
    """Derive a dedicated CAS signing key from the server's secret key using HKDF."""
    hkdf = HKDF(algorithm=hashes.SHA256(), length=32, salt=b"wikint-cas-salt-v1", info=_CAS_INFO)
    return hkdf.derive(settings.secret_key.get_secret_value().encode())


_cas_signing_key: bytes | None = None


def hmac_cas_key(sha256: str) -> str:
    """Return the HMAC-keyed Redis CAS key for a file SHA-256.

    The HMAC prevents cross-user probing: a user who knows their file's SHA-256
    cannot compute the CAS key for a file they have never seen.

    Uses HKDF to derive a dedicated signing key from the server's secret,
    ensuring domain separation between CAS and other HMAC uses.
    """
    global _cas_signing_key
    if _cas_signing_key is None:
        _cas_signing_key = _derive_cas_signing_key()
    digest = _hmac.new(_cas_signing_key, sha256.encode(), hashlib.sha256).hexdigest()
    return f"upload:cas:{digest}"
