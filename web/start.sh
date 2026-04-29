#!/bin/bash
set -e

cd "$(dirname "$0")"

# Use the virtual environment
source .venv/bin/activate

# Start the web server
exec uvicorn main:app --host 0.0.0.0 --port 8765 --reload
