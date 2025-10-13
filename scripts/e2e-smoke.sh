#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[smoke] Checking backend health..."
if ! curl -sSf http://localhost:3001/health >/dev/null 2>&1; then
  echo "[smoke] Backend not responding at 3001. Start it with: (cd server && npm run dev)" >&2
  exit 1
fi

echo "[smoke] Opening frontend at http://localhost:5173 ..."
if command -v open >/dev/null 2>&1; then
  open http://localhost:5173/
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open http://localhost:5173/
else
  echo "[smoke] Please open http://localhost:5173/ manually."
fi

echo "[smoke] OK"



