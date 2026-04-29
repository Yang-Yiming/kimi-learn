#!/bin/bash
set -e

# Run from project root so package imports work
cd "$(dirname "$0")/.."

# Use the virtual environment
source web/.venv/bin/activate

# Start the web server
exec uvicorn web.main:app --host 0.0.0.0 --port 8765 --reload
