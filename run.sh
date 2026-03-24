#!/bin/bash

cd "$(dirname "$0")"

PROFILES="--profile onlyoffice"

if [ "$1" = "--prod" ]; then
    echo "Pulling latest images..."
    docker compose -f docker-compose.yml $PROFILES pull
    docker compose -f docker-compose.yml $PROFILES down
    echo "Starting production environment..."
    docker compose -f docker-compose.yml $PROFILES up -d
elif [ "$1" = "--dev" ]; then
    echo "Starting development environment with hot-reloading..."
    # The dev override uses bind mounts and specific dev commands (uvicorn --reload, pnpm dev)
    # to automatically update when files are modified locally.
    docker compose -f docker-compose.yml -f docker-compose.dev.yml $PROFILES up --build
else
    echo "Usage: ./run.sh [--prod|--dev]"
    echo ""
    echo "  --prod    Start the production environment"
    echo "  --dev     Start the development environment (with hot-reloading)"
    exit 1
fi
