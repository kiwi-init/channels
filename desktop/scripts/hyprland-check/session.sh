#!/usr/bin/env bash
set -u

usage="usage: session.sh TEST_APP OUT (started by Hyprland, in its session)"
app=${1:?$usage}
out=${2:?$usage}
repo=$(cd "$(dirname "$0")/../../.." && pwd)
exec > "$out/session.log" 2>&1
echo "WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-} DISPLAY=${DISPLAY:-} XDG_CURRENT_DESKTOP=${XDG_CURRENT_DESKTOP:-} HYPRLAND_INSTANCE_SIGNATURE=${HYPRLAND_INSTANCE_SIGNATURE:-}"
hyprctl monitors -j
cd "$repo" || exit 1
timeout 480 bun desktop/scripts/hyprland-glass-check.ts "$app" "$out" > "$out/check.log" 2>&1
echo $? > "$out/check.code"
touch "$out/done"
