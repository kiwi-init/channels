#!/usr/bin/env bash
set -u
D=$1
OUT=$2
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d)
chmod 700 "$XDG_RUNTIME_DIR"
dpkg-query -W -f '${Package} ${Version}\n' libgtk-3-0t64 libgtk-3-0 libwebkit2gtk-4.1-0 kwin-wayland gnome-shell mutter-common xwayland libayatana-appindicator3-1 xdg-desktop-portal kiwi-desktop 2> /dev/null | tee "$OUT/versions.txt"

if [ "$D" = kde-focus ]; then
  export XDG_CONFIG_HOME KWIN_LOG="$OUT/kwin-focus.log"
  XDG_CONFIG_HOME=$(mktemp -d)
  printf '[Windows]\nFocusStealingPreventionLevel=%s\n' "${FSP:-3}" > "$XDG_CONFIG_HOME/kwinrc"
  timeout 600 dbus-run-session -- env LIBGL_ALWAYS_SOFTWARE=1 QT_LOGGING_RULES='kwin_*=true;kwin_scripting.debug=true' QT_QPA_PLATFORMTHEME=generic XDG_SESSION_TYPE=wayland \
    kwin_wayland --virtual --xwayland --width 1280 --height 800 --socket kiwi-wayland --exit-with-session "bash $HERE/focus.sh $OUT" > "$KWIN_LOG" 2>&1
  echo "kwin (focus) exited $?" | tee -a "$OUT/focus.txt"
  grep -iE 'activat|token|focus steal' "$KWIN_LOG" | grep -v 'js:' | head -n 60 > "$OUT/kwin-activation-lines.txt"
  exit 0
fi

if [ "$D" = kde ]; then
  kwin_wayland --help > "$OUT/kwin-help.txt" 2>&1
  for scale in 1 1.5; do
    tag=main
    [ "$scale" = 1 ] || tag="scale${scale/./}"
    export KWIN_LOG="$OUT/kwin-$tag.log"
    kenv=(env LIBGL_ALWAYS_SOFTWARE=1 KWIN_SCREENSHOT_NO_PERMISSION_CHECKS=1 QT_LOGGING_RULES='kwin_*=true;kwin_scripting.debug=true' QT_QPA_PLATFORMTHEME=generic XDG_SESSION_TYPE=wayland)
    kargs=(kwin_wayland --virtual --xwayland --width 1280 --height 800 --scale "$scale" --socket kiwi-wayland --exit-with-session "bash $HERE/inner.sh kde $OUT $tag")
    timeout 600 dbus-run-session -- "${kenv[@]}" "${kargs[@]}" > "$KWIN_LOG" 2>&1
    code=$?
    echo "kwin ($tag) exited $code" | tee -a "$OUT/notes.txt"
    if [ "$code" -ge 128 ] && [ "$tag" = main ]; then
      timeout 300 dbus-run-session -- "${kenv[@]}" gdb -batch -ex run -ex 'thread apply all bt 20' --args "${kargs[@]}" > "$OUT/kwin-gdb.log" 2>&1
      grep -A40 'SIGSEGV\|SIGABRT' "$OUT/kwin-gdb.log" | head -n 80 | tee -a "$OUT/notes.txt"
    fi
  done
  exit 0
fi

gnome-shell --help > "$OUT/gnome-shell-help.txt" 2>&1
command -v gdctl > /dev/null && gdctl --help > "$OUT/gdctl-help.txt" 2>&1
cat > "$OUT/gnome-session.sh" << EOF
set -u
gsettings set org.gnome.shell introspect true
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
extra=""
grep -q -- '--unsafe-mode' "$OUT/gnome-shell-help.txt" && extra="--unsafe-mode"
gnome-shell --headless --wayland --virtual-monitor 1280x800 --debug-control \$extra > "$OUT/gnome-shell.log" 2>&1 &
shell=\$!
for _ in \$(seq 1 100); do
  [ -S "\$XDG_RUNTIME_DIR/wayland-0" ] && gdbus introspect --session --dest org.gnome.Shell --object-path /org/gnome/Shell > /dev/null 2>&1 && break
  sleep 0.3
done
sleep 3
for obj in /org/gnome/Shell /org/gnome/Shell/DebugControl /org/gnome/Mutter/DebugControl; do
  for dest in org.gnome.Shell org.gnome.Shell.DebugControl org.gnome.Mutter.DebugControl; do
    gdbus introspect --session --dest \$dest --object-path \$obj 2>/dev/null | grep -iE 'interface|unsafe|property' | sed "s|^|\$dest \$obj: |" >> "$OUT/debug-control.txt"
  done
done
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/DebugControl --method org.freedesktop.DBus.Properties.Set org.gnome.Shell.DebugControl UnsafeMode "<true>" >> "$OUT/debug-control.txt" 2>&1
gsettings get org.gnome.shell introspect >> "$OUT/debug-control.txt" 2>&1
x=\$(grep -oE 'Using public X11 display :[0-9]+' "$OUT/gnome-shell.log" | grep -oE ':[0-9]+' | head -n 1)
[ -n "\$x" ] || x=\$(ls /tmp/.X11-unix 2> /dev/null | sed 's/^X/:/' | sort | head -n 1)
auth=\$(ls "\$XDG_RUNTIME_DIR"/.mutter-Xwaylandauth.* 2> /dev/null | head -n 1)
echo "gnome-shell up: X display \$x, auth \$auth" | tee -a "$OUT/notes.txt"
export WAYLAND_DISPLAY=wayland-0 DISPLAY="\$x" XAUTHORITY="\$auth" XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=GNOME
/usr/libexec/gsd-xsettings > "$OUT/gsd-xsettings.log" 2>&1 &
/usr/libexec/xdg-desktop-portal > "$OUT/portal.log" 2>&1 &
sleep 3
bash "$HERE/inner.sh" gnome "$OUT" main
kill \$shell
EOF
timeout 600 dbus-run-session -- bash "$OUT/gnome-session.sh"
echo "gnome session exited $?" | tee -a "$OUT/notes.txt"
