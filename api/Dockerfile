FROM python:3.12-slim

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Install system dependencies for yara-python
RUN apt-get update && apt-get install -y --no-install-recommends libyara-dev && rm -rf /var/lib/apt/lists/*

# Create user early and take ownership of the working directory
RUN groupadd -r appuser && useradd -r -g appuser -m appuser && chown appuser:appuser /app

# Switch to non-root user before installing dependencies
USER appuser

COPY --chown=appuser:appuser pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY --chown=appuser:appuser . .
RUN chmod +x start.sh worker-start.sh

EXPOSE 8000

ENTRYPOINT ["./start.sh"]
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
