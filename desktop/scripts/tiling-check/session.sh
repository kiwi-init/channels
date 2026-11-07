#!/usr/bin/env bash
set -u

usage="usage: session.sh sway|hyprland TEST_APP OUT (started by the compositor, in its session)"
compositor=${1:?$usage}
app=${2:?$usage}
out=${3:?$usage}
repo=$(cd "$(dirname "$0")/../../.." && pwd)
exec > "$out/session.log" 2>&1
echo "WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-} DISPLAY=${DISPLAY:-} XDG_CURRENT_DESKTOP=${XDG_CURRENT_DESKTOP:-} SWAYSOCK=${SWAYSOCK:-} HYPRLAND_INSTANCE_SIGNATURE=${HYPRLAND_INSTANCE_SIGNATURE:-}"

windows() {
  case "$compositor" in
    sway) swaymsg -t get_tree -r | jq -c '[.. | objects | select(.type == "con" or .type == "floating_con") | select(.app_id != null) | {app: .app_id, title: .name, focused, x: .rect.x, y: .rect.y, w: .rect.width, h: .rect.height}]' ;;
    hyprland) hyprctl clients -j | jq -c '[.[] | {app: .class, title, focused: (.focusHistoryID == 0), x: .at[0], y: .at[1], w: .size[0], h: .size[1]}]' ;;
  esac
}
outputs() {
  case "$compositor" in
    sway) swaymsg -t get_outputs -r | jq -c '[.[] | {name, w: .rect.width, h: .rect.height, scale}]' ;;
    hyprland) hyprctl monitors -j | jq -c '[.[] | {name, w: .width, h: .height, scale}]' ;;
  esac
}
echo "outputs: $(outputs)"
(
  last=""
  while :; do
    now=$(windows 2> /dev/null)
    [ "$now" != "$last" ] && echo "$(date +%T) $now"
    last=$now
    sleep 1
  done
) > "$out/windows.log" 2>&1 &
sampler=$!

cd "$repo" || exit 1
for check in mods figure; do
  started=$(date +%s)
  timeout 900 bun "desktop/scripts/eb-$check-check.ts" "$app" "$out/$check" > "$out/$check.log" 2>&1
  echo $? > "$out/$check.code"
  echo "$check check: exit $(cat "$out/$check.code") after $(($(date +%s) - started)) s"
done
kill "$sampler" 2> /dev/null
touch "$out/done"
