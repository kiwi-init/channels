#!/usr/bin/env bash
set -u
DISTRO=$1
KEYRING=$2
OUT=$3
APPVER=$4
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
chmod 777 "$OUT"
touch "$OUT/notes.txt"
chmod 666 "$OUT/notes.txt"
note() { echo "== [$DISTRO/$KEYRING] $*" | tee -a "$OUT/notes.txt"; }
install() {
  if [ "$DISTRO" = fedora ]; then dnf -y -q install --skip-unavailable "$@" > "$OUT/install.log" 2>&1 || { note "dnf install $* failed"; tail -n 5 "$OUT/install.log"; }; else pacman -S --noconfirm --needed "$@" > "$OUT/install.log" 2>&1 || { note "pacman -S $* failed"; tail -n 5 "$OUT/install.log"; }; fi
}
if [ "$DISTRO" = fedora ]; then
  base=(webkit2gtk4.1 gtk3 librsvg2 bubblewrap xdg-dbus-proxy libsecret dbus-daemon dbus-tools python3-gobject procps-ng findutils which file mesa-dri-drivers mesa-libEGL util-linux glib2)
  extra=(weston)
  kwallet=(kf6-kwallet)
  keyring=(gnome-keyring)
  ayatana=(libayatana-appindicator-gtk3)
else
  pacman -Syu --noconfirm > "$OUT/install.log" 2>&1
  base=(webkit2gtk-4.1 gtk3 librsvg bubblewrap xdg-dbus-proxy libsecret python-gobject procps-ng which file mesa util-linux glib2 dbus)
  extra=(weston)
  kwallet=(kwallet)
  keyring=(gnome-keyring)
  ayatana=(libayatana-appindicator)
fi
case "$KEYRING" in
  kwallet) install "${base[@]}" "${extra[@]}" "${kwallet[@]}" ;;
  gnome-keyring) install "${base[@]}" "${extra[@]}" "${keyring[@]}" ;;
  *) install "${base[@]}" "${extra[@]}" ;;
esac
. /etc/os-release
dbus-uuidgen --ensure=/etc/machine-id 2> /dev/null || true
mkdir -p /var/lib/dbus /run/dbus
[ -f /var/lib/dbus/machine-id ] || cp /etc/machine-id /var/lib/dbus/machine-id
dbus-daemon --system --fork && note "system bus up" || note "no system bus"
note "$PRETTY_NAME; $(rpm -q webkit2gtk4.1 gtk3 weston kf6-kwallet gnome-keyring 2> /dev/null | tr '\n' ' ')$(pacman -Q webkit2gtk-4.1 gtk3 weston kwallet gnome-keyring 2> /dev/null | tr '\n' ' ')"
useradd -m tester
cp "$HERE"/*.py "$HERE"/*.js "$HERE"/session.sh /home/tester/
curl -fsSL -o /home/tester/Channels.AppImage "https://github.com/kiwi-init/channels/releases/download/v$APPVER/Channels-$APPVER-linux-x86_64.AppImage"
chmod +x /home/tester/Channels.AppImage
chown -R tester: /home/tester
runuser -u tester -- sh -c 'cd /home/tester && ./Channels.AppImage --appimage-extract > /dev/null' || note "the AppImage didn't extract"
APP=/home/tester/squashfs-root/Channels

missing() {
  note "libraries the app's binaries can't find ($1):"
  for f in /home/tester/squashfs-root/Channels/bin/*.so /home/tester/squashfs-root/Channels/bin/bun /home/tester/squashfs-root/Channels/bin/electrobun-launcher; do
    m=$(ldd "$f" 2> /dev/null | grep 'not found' | awk '{print $1}' | tr '\n' ' ')
    [ -n "$m" ] && echo "   $(basename "$f"): $m" | tee -a "$OUT/notes.txt"
  done
  echo "   (end)" | tee -a "$OUT/notes.txt"
}

session() {
  tag=$1
  rt=$(mktemp -d)
  chown tester: "$rt"
  chmod 700 "$rt"
  runuser -u tester -- env XDG_RUNTIME_DIR="$rt" timeout 200 dbus-run-session -- bash /home/tester/session.sh "$KEYRING" "$OUT" "$tag" "$APP"
  note "session $tag exited $?"
}

missing "without libayatana-appindicator"
session no-ayatana
install "${ayatana[@]}"
missing "with libayatana-appindicator"
session with-ayatana
