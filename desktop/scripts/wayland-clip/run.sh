#!/usr/bin/env bash
set -u
APP=$1
OUT=$2
D=$3
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d)
chmod 700 "$XDG_RUNTIME_DIR"
unset DISPLAY XAUTHORITY GDK_BACKEND
dpkg-query -W -f '${Package} ${Version}\n' libgtk-3-0t64 libwebkit2gtk-4.1-0 kwin-wayland gnome-shell mutter-common xwayland 2> /dev/null | tee "$OUT/$D-versions.txt"

if [ "$D" = kde ]; then
  wayland-scanner client-header /usr/share/plasma-wayland-protocols/fake-input.xml "$RUNNER_TEMP/fake-input-client-protocol.h"
  wayland-scanner private-code /usr/share/plasma-wayland-protocols/fake-input.xml "$RUNNER_TEMP/fake-input-protocol.c"
  cc -O2 -Wall -Wextra -I"$RUNNER_TEMP" -o "$RUNNER_TEMP/kwin-input" "$HERE/kwin-input.c" "$RUNNER_TEMP/fake-input-protocol.c" $(pkg-config --cflags --libs wayland-client) || exit 1
  export KWIN_LOG="$OUT/kde-kwin.log"
  timeout 900 dbus-run-session -- env KWIN_WAYLAND_NO_PERMISSION_CHECKS=1 KWIN_SCREENSHOT_NO_PERMISSION_CHECKS=1 LIBGL_ALWAYS_SOFTWARE=1 \
    QT_LOGGING_RULES='kwin_scripting.debug=true' QT_QPA_PLATFORMTHEME=generic XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=KDE \
    kwin_wayland --virtual --width 1920 --height 1080 --socket kiwi-kwin --exit-with-session "bash $HERE/inner.sh kde $APP $OUT $RUNNER_TEMP/kwin-input" > "$KWIN_LOG" 2>&1
  echo "kwin exited $?"
  exit 0
fi

gnome-shell --help > "$OUT/gnome-shell-help.txt" 2>&1
cat > "$OUT/gnome-session.sh" << EOF
set -u
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
extra=""
grep -q -- '--unsafe-mode' "$OUT/gnome-shell-help.txt" && extra="\$extra --unsafe-mode"
grep -q -- '--no-x11' "$OUT/gnome-shell-help.txt" && extra="\$extra --no-x11"
echo "gnome-shell flags: \$extra"
gnome-shell --headless --wayland --virtual-monitor 1920x1080 \$extra > "$OUT/gnome-shell.log" 2>&1 &
shell=\$!
for _ in \$(seq 1 100); do
  [ -S "\$XDG_RUNTIME_DIR/wayland-0" ] && gdbus introspect --session --dest org.gnome.Shell --object-path /org/gnome/Shell > /dev/null 2>&1 && break
  sleep 0.3
done
sleep 3
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/DebugControl --method org.freedesktop.DBus.Properties.Set org.gnome.Shell.DebugControl UnsafeMode "<true>" || true
WAYLAND_DISPLAY=wayland-0 XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=GNOME bash "$HERE/inner.sh" gnome "$APP" "$OUT"
kill \$shell
EOF
timeout 900 dbus-run-session -- bash "$OUT/gnome-session.sh"
echo "gnome session exited $?"
