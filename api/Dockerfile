# Stage 1: Build environment
FROM python:3.12-slim AS builder

WORKDIR /app

# Install uv and build essentials for native deps (like yara-python)
RUN pip install --no-cache-dir uv && \
    apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libyara-dev \
    && rm -rf /var/lib/apt/lists/*

# Create venv directory and sync dependencies
RUN mkdir /venv
COPY pyproject.toml uv.lock ./
ENV UV_PROJECT_ENVIRONMENT=/venv
RUN uv sync --frozen --no-dev

# Stage 2: Runtime environment
FROM python:3.12-slim

WORKDIR /app

# Install uv (for running the app) and runtime dependencies
# ghostscript (PDF), ffmpeg (video), bubblewrap (sandbox), exiftool (metadata)
RUN pip install --no-cache-dir uv && \
    apt-get update && apt-get install -y --no-install-recommends \
    libyara10 \
    ghostscript \
    ffmpeg \
    bubblewrap \
    libimage-exiftool-perl \
    && rm -rf /var/lib/apt/lists/*

# Create user first (must exist before --chown in COPY)
RUN groupadd -r appuser && useradd -r -g appuser -m appuser && \
    chown appuser:appuser /app

# Copy virtual environment from builder with correct ownership
COPY --from=builder --chown=appuser:appuser /venv /venv
ENV UV_PROJECT_ENVIRONMENT=/venv

USER appuser

# Copy application code (context is already filtered by .dockerignore)
COPY --chown=appuser:appuser . .
RUN chmod +x start.sh worker-start.sh

EXPOSE 8000

ENTRYPOINT ["./start.sh"]
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
