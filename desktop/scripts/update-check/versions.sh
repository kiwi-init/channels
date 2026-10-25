#!/usr/bin/env bash
set -u
for v in "$@"; do
  [[ "$v" =~ ^[0-9]+(\.[0-9]+){2}$ ]] || { echo "::error::$v isn't a release version like 0.27.7 or 2026.10.0"; exit 1; }
done
[ "$#" -eq 2 ] || { echo "::error::usage: versions.sh FROM TO"; exit 1; }
latest=$(curl -sI "https://github.com/$GITHUB_REPOSITORY/releases/latest" | tr -d '\r' | awk 'tolower($1) == "location:" { n = split($2, p, "/"); print p[n] }')
[ "$latest" = "v$2" ] || { echo "::error::GitHub's latest release is $latest, not v$2: the installed app would update to $latest instead"; exit 1; }
echo "checking that $1 updates itself to $2, GitHub's latest release"
