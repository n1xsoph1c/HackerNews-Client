#!/bin/sh
set -e

echo "==> Syncing database schema..."
npx prisma db push --accept-data-loss

echo "==> Pre-pulling Ollama model: ${OLLAMA_MODEL:-llama3.2:3b}"
# Pull in background — app starts immediately, model downloads in background
# User can track progress in the /models page
curl -s -X POST "${OLLAMA_BASE_URL:-http://ollama:11434}/api/pull" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${OLLAMA_MODEL:-llama3.2:3b}\"}" \
  --max-time 1800 \
  > /dev/null 2>&1 &

echo "==> Starting server..."
exec node server.js
