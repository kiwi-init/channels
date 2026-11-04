#!/usr/bin/env bash
set -euo pipefail

: "${SHA:?SHA is the commit to publish}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is where the gate writes go and sha}"

paths=(
  ui
  packages/app
  packages/core
  packages/secrets
  packages/channel
  desktop/src/ui-channel.ts
  desktop/scripts/ui-stage.ts
  .github/workflows/ui-publish.yml
  scripts/ui-publish-gate.sh
  bun.lock
)

say() {
  echo "go=$1" >> "$GITHUB_OUTPUT"
  echo "sha=$SHA" >> "$GITHUB_OUTPUT"
  echo "$2"
}

if [ "${EVENT:-}" = "workflow_dispatch" ]; then
  say true "a person asked for this publish: $SHA"
  exit 0
fi

live=$(gh release download livewire-ui --pattern manifest.json --output - 2> /dev/null | jq -r '.uiVersion // empty' || true)
prev=${live##*-}

if [ -z "$prev" ] || ! git cat-file -e "$prev^{commit}" 2> /dev/null; then
  say true "no live UI commit to compare with (${live:-none}): publishing $SHA"
  exit 0
fi

if git diff --quiet "$prev" "$SHA" -- "${paths[@]}"; then
  say false "the UI is unchanged since the live $live: nothing to publish for $SHA"
else
  say true "the UI changed since the live $live: publishing $SHA"
fi
