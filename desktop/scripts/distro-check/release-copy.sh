#!/bin/bash
set -euo pipefail

usage="usage: release-copy.sh FROM.AppImage TO.AppImage RELEASE_ID (a copy of a dev build that carries the release identifier, for checks only)"
from=$(realpath "${1:?$usage}")
to=${2:?$usage}
release=${3:?$usage}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
offset=$("$from" --appimage-offset)
(cd "$work" && "$from" --appimage-extract > /dev/null)
version="$work/squashfs-root/Channels/Resources/version.json"
[ -f "$version" ] || { echo "no Channels/Resources/version.json in $from" >&2; exit 1; }
sed -i -E "s/\"identifier\":\"[^\"]*\"/\"identifier\":\"$release\"/" "$version"
grep -q "\"identifier\":\"$release\"" "$version" || { echo "version.json names no identifier to replace" >&2; exit 1; }
mksquashfs "$work/squashfs-root" "$work/image.squashfs" -root-owned -noappend -comp zstd -Xcompression-level 3 -b 131072 -quiet > /dev/null
head -c "$offset" "$from" > "$to"
cat "$work/image.squashfs" >> "$to"
chmod +x "$to"
