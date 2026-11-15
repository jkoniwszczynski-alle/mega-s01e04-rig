#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p .preview
temp="$(mktemp -d)"
port="${PORT:-18787}"
server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -f "$temp/server.log" "$temp/index.html"
  rmdir "$temp"
}
trap cleanup EXIT

PORT="$port" node --import tsx --env-file-if-exists=.env src/server.ts >"$temp/server.log" 2>&1 &
server_pid=$!
ready=false
for ((attempt = 0; attempt < 100; attempt++)); do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$temp/server.log" >&2
    exit 1
  fi
  if grep -Fq "http://localhost:$port" "$temp/server.log"; then
    ready=true
    break
  fi
  sleep 0.1
done
if [[ "$ready" != true ]]; then
  echo "Server did not start in time." >&2
  exit 1
fi

curl --fail --silent --show-error \
  "http://127.0.0.1:$port/digest/2026-10-28" >"$temp/index.html"
grep -Fq '<!doctype html>' "$temp/index.html"
mv "$temp/index.html" .preview/index.html
echo "Saved .preview/index.html (not tracked by Git)."
