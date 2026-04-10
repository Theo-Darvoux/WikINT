FROM python:3.12-slim

WORKDIR /app

# Install uv via pip to avoid ghcr.io network timeouts
RUN pip install --no-cache-dir uv
# Install system dependencies for yara-python, ghostscript (PDF compression), ffmpeg (video compression), bubblewrap (sandboxing), and exiftool (metadata stripping)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libyara-dev \
    ghostscript \
    ffmpeg \
    bubblewrap \
    libimage-exiftool-perl \
    && rm -rf /var/lib/apt/lists/*

# Create user early and take ownership of the working directory
RUN groupadd -r appuser && useradd -r -g appuser -m appuser && chown appuser:appuser /app

# Create venv directory and take ownership
RUN mkdir /venv && chown appuser:appuser /venv

# Switch to non-root user before installing dependencies
USER appuser

# Move venv outside of /app so it's not hidden by the host mount
ENV UV_PROJECT_ENVIRONMENT=/venv

COPY --chown=appuser:appuser pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY --chown=appuser:appuser . .
RUN chmod +x start.sh worker-start.sh

EXPOSE 8000

ENTRYPOINT ["./start.sh"]
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
