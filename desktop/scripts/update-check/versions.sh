#!/usr/bin/env bash
set -u
for v in "$@"; do
  [[ "$v" =~ ^[0-9]+(\.[0-9]+){2}-livewire\.[0-9]+$ ]] || { echo "::error::$v isn't a Channels Livewire version like 2026.10.2-livewire.2"; exit 1; }
done
[ "$#" -eq 2 ] || { echo "::error::usage: versions.sh FROM TO"; exit 1; }
newest=$(curl -s "https://github.com/$GITHUB_REPOSITORY/releases.atom" | grep -oE 'releases/tag/v[0-9]+\.[0-9]+\.[0-9]+-livewire\.[0-9]+"' | sed -E 's#releases/tag/v##; s#"$##' | sort -V | tail -n 1)
[ "$newest" = "$2" ] || { echo "::error::the newest Channels Livewire release is ${newest:-none}, not $2: the installed app would update to that instead"; exit 1; }
latest=$(curl -sI "https://github.com/$GITHUB_REPOSITORY/releases/latest" | tr -d '\r' | awk 'tolower($1) == "location:" { n = split($2, p, "/"); print p[n] }')
[[ "$latest" != *-livewire.* ]] || { echo "::error::GitHub's latest release is $latest, a Channels Livewire RC, so stable users would get it"; exit 1; }
echo "checking that $1 updates itself to $2, the newest Channels Livewire release (stable's latest is still $latest)"
