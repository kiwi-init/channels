#!/usr/bin/env bash
set -u

usage="usage: kwin.sh TEST_APP_FOLDER OUT_DIR (runs desktop/scripts/wayland-check.ts in a headless KWin with no XWayland)"
app=${1:?$usage}
out=${2:?$usage}
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out"
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d)
chmod 700 "$XDG_RUNTIME_DIR"
unset DISPLAY XAUTHORITY GDK_BACKEND

protocol=/usr/share/plasma-wayland-protocols/fake-input.xml
wayland-scanner client-header "$protocol" "$out/fake-input-client-protocol.h" || exit 1
wayland-scanner private-code "$protocol" "$out/fake-input-protocol.c" || exit 1
cc -O2 -Wall -Wextra -Werror -I"$out" -o "$out/kwin-input" "$here/kwin-input.c" "$out/fake-input-protocol.c" $(pkg-config --cflags --libs wayland-client) || exit 1

export KWIN_LOG="$out/kwin.log"
results="$out/results.json"
rm -f "$results"
timeout 600 dbus-run-session -- env KWIN_WAYLAND_NO_PERMISSION_CHECKS=1 LIBGL_ALWAYS_SOFTWARE=1 QT_LOGGING_RULES='kwin_scripting.debug=true' QT_QPA_PLATFORMTHEME=generic \
  XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=KDE \
  kwin_wayland --virtual --width 1920 --height 1080 --socket kiwi-kwin --exit-with-session "bun $here/../wayland-check.ts $app $results $out/kwin-input" > "$KWIN_LOG" 2>&1
echo "kwin_wayland exited $?"
if pgrep -x Xwayland > /dev/null; then echo "an Xwayland ran, so this session wasn't Wayland-only"; exit 1; fi
[ -s "$results" ] || { echo "the check left no results:"; tail -n 80 "$KWIN_LOG"; exit 1; }
cat "$results"
bun -e 'const r = JSON.parse(await Bun.file(process.argv[1]).text()); process.exit(r.length > 0 && r.every((c) => c.ok) ? 0 : 1)' "$results" || {
  echo "::group::KWin's log"
  tail -n 120 "$KWIN_LOG"
  echo "::endgroup::"
  exit 1
}
