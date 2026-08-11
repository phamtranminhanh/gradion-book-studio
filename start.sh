#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then npm install --silent; fi
if [ -f .env ]; then set -a; . ./.env; set +a; fi
exec npm start
