import urllib.parse
from urllib.parse import urlparse, urlunparse

def rewrite_host(url, public_endpoint):
    parsed = urlparse(url)
    scheme = "https" if "localhost" not in public_endpoint else "http"
    return urlunparse(parsed._replace(netloc=public_endpoint, scheme=scheme))

url = "https://12345.r2.cloudflarestorage.com/wikint/abc?X-Amz-SignedHeaders=host"
print(rewrite_host(url, "files.wikint.hypnos2026.fr"))
