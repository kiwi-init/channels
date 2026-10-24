#!/usr/bin/env bash
set -euo pipefail
sums=${1:?usage: desktop/scripts/sign-sums.sh SHA256SUMS "trusted comment"}
comment=${2:?usage: desktop/scripts/sign-sums.sh SHA256SUMS "trusted comment"}
if [ -z "${MINISIGN_SECRET_KEY:-}" ]; then
  echo "::error::MINISIGN_SECRET_KEY isn't set: without SHA256SUMS.minisig no Linux app updates itself to this release"
  exit 1
fi
command -v minisign > /dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq minisign; }
key=$(mktemp "${RUNNER_TEMP:-/tmp}/minisign.XXXXXX")
trap 'rm -f "$key"' EXIT
printf '%s\n' "$MINISIGN_SECRET_KEY" > "$key"
minisign -S -s "$key" -m "$sums" -x "$sums.minisig" -t "$comment"
bun "$(dirname "$0")/verify-sums.ts" "$sums" "$sums.minisig"
