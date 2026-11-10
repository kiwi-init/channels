#!/usr/bin/env bash
set -euo pipefail

usage="usage: check.sh APPDIR WORK"
appdir=${1:?$usage}
work=${2:?$usage}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if [ -z "${ICON_THEME_CHECK_BUS:-}" ]; then
  rm -rf "$work"
  mkdir -p "$work/home/config" "$work/cache" "$work/shots"
  g++ -std=c++20 -O1 -fPIC -o "$work/probe" "$here/probe.cpp" $(pkg-config --cflags --libs Qt6Gui) -I/usr/include/KF6/KIconThemes -lKF6IconThemes
  bun "$here/../icon-theme-install.ts" "$appdir" "$work/home" | sed 's/^/keepEntry wrote /'
  ICON_THEME_CHECK_BUS=1 exec dbus-run-session -- bash "${BASH_SOURCE[0]}" "$appdir" "$work"
fi

export XDG_DATA_HOME="$work/home/data" XDG_CONFIG_HOME="$work/home/config" XDG_CACHE_HOME="$work/cache" XDG_DATA_DIRS=/usr/share QT_QPA_PLATFORM=offscreen
theme() {
  printf '[Icons]\nTheme=%s\n' "$1" > "$XDG_CONFIG_HOME/kdeglobals"
}
reported() {
  for _ in $(seq 1 100); do
    grep -q "^$1 [^ ]* 128 " "$work/probe.log" && return 0
    sleep 0.1
  done
  echo "the probe never reported step $1"
  cat "$work/probe.log" "$work/probe.err"
  exit 1
}
switch() {
  theme "$1"
  dbus-send --session --type=signal /KIconLoader org.kde.KIconLoader.iconChanged int32:0
}

theme breeze
"$work/probe" channels-desktop "$work/shots" 2 > "$work/probe.log" 2> "$work/probe.err" &
probe=$!
reported 0
switch breeze-dark
reported 1
switch breeze
reported 2
wait "$probe"
cat "$work/probe.log"

dark="$XDG_DATA_HOME/icons/breeze-dark/apps/48/channels-desktop.svg"
awk -v dark="$dark" '
  $5 < 250 { print "step " $1 ", " $2 ", " $3 " px: the tile is see-through (alpha " $5 "), so nothing drew it from " $6; bad = 1 }
  $1 == 1 && ($2 != "breeze-dark" || $4 > 90 || $6 != dark) { print "Breeze Dark, " $3 " px: theme " $2 ", tile luma " $4 ", from " $6 "; wanted the dark tile from " dark; bad = 1 }
  $1 != 1 && ($2 != "breeze" || $4 < 170 || $6 !~ /\/icons\/hicolor\//) { print "step " $1 ", Breeze, " $3 " px: theme " $2 ", tile luma " $4 ", from " $6 "; wanted the light tile from hicolor"; bad = 1 }
  END { exit bad }
' "$work/probe.log"
echo "checked: one running KIconLoader consumer draws the light tile under Breeze, the dark tile from breeze-dark under Breeze Dark, and the light tile again, each after the iconChanged signal Plasma sends"
