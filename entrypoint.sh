#!/bin/sh
set -e

echo "==> Syncing database schema..."
npx prisma db push --accept-data-loss

echo "==> Pre-pulling Ollama model: ${OLLAMA_MODEL:-phi4-mini}"
# Pull in background then warm up — app starts immediately, model downloads in background.
# After the pull finishes, send a minimal generate request to load weights into memory/VRAM
# so the first user summarize request hits a warm model instead of a 60s cold-load.
(
  curl -s -X POST "${OLLAMA_BASE_URL:-http://ollama:11434}/api/pull" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${OLLAMA_MODEL:-phi4-mini}\"}" \
    --max-time 1800 \
    > /dev/null 2>&1

  echo "==> Warming up model: ${OLLAMA_MODEL:-phi4-mini}"
  curl -s -X POST "${OLLAMA_BASE_URL:-http://ollama:11434}/api/generate" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"${OLLAMA_MODEL:-phi4-mini}\",\"prompt\":\"hi\",\"stream\":false,\"options\":{\"num_predict\":1}}" \
    > /dev/null 2>&1 || true
) &

echo "==> Starting server..."
exec node server.js
