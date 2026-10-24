#!/usr/bin/env bash
set -u
OUT=$1
BEFORE=$2
AFTER=$3
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"

take() {
  local label=$1 deb=$2 scheme=$3 flip=${4:-}
  sudo apt-get install -y --allow-downgrades "$deb" > "$OUT/install-$label.log" 2>&1 || { echo "install failed for $label"; tail -n 20 "$OUT/install-$label.log"; return; }
  dpkg-query -W kiwi-desktop | tee -a "$OUT/notes.txt"
  local home
  home=$(mktemp -d)
  dbus-run-session -- bash -c "
    python3 '$HERE/portal-mock.py' $scheme > '$OUT/mock-$label.log' 2>&1 & mock=\$!
    sleep 1
    Xvfb :99 -screen 0 1280x800x24 > /dev/null 2>&1 & x=\$!
    sleep 1
    DISPLAY=:99 HOME='$home' WEBKIT_DISABLE_DMABUF_RENDERER=1 /opt/Channels/bin/launcher > '$OUT/app-$label.log' 2>&1 &
    sleep 25
    DISPLAY=:99 import -window root '$OUT/$label.png'
    if [ -n '$flip' ]; then kill -USR1 \$mock; sleep 5; DISPLAY=:99 import -window root '$OUT/$label-then-flipped.png'; fi
    pkill -TERM -f /opt/Channels/bin/; sleep 3; pkill -KILL -f /opt/Channels/bin/
    kill \$x \$mock
  "
  echo "took $label (portal color-scheme $scheme${flip:+, then flipped live})" | tee -a "$OUT/notes.txt"
}

take before-dark "$BEFORE" 1
take after-dark "$AFTER" 1
take after-light "$AFTER" 2 flip
