#!/usr/bin/env bash
set -u
DISTRO=$1
DESK=$2
OUT=$3
VERSION=$4
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
chmod 777 "$OUT"
note() { echo "== [$DISTRO/$DESK] $*" | tee -a "$OUT/notes.txt"; }
install() {
  if [ "$DISTRO" = fedora ]; then dnf -y -q install "$@" > "$OUT/install.log" 2>&1 || { note "dnf install $* failed"; tail -n 5 "$OUT/install.log"; }; else pacman -S --noconfirm --needed "$@" > "$OUT/install.log" 2>&1 || { note "pacman -S $* failed"; tail -n 5 "$OUT/install.log"; }; fi
}
if [ "$DISTRO" = fedora ]; then
  base=(webkit2gtk4.1 gtk3 librsvg2 bubblewrap xdg-dbus-proxy libsecret dbus-daemon dbus-tools python3-gobject procps-ng findutils which file mesa-dri-drivers mesa-libEGL util-linux glib2)
  kde=(kwin-wayland kf6-kwallet)
  gnome=(gnome-shell gnome-keyring xdg-desktop-portal-gnome)
  ayatana=(libayatana-appindicator-gtk3)
else
  pacman -Syu --noconfirm > "$OUT/install.log" 2>&1
  base=(webkit2gtk-4.1 gtk3 librsvg bubblewrap xdg-dbus-proxy libsecret python-gobject procps-ng which file mesa util-linux glib2 dbus)
  kde=(kwin kwallet)
  gnome=(gnome-shell gnome-keyring xdg-desktop-portal-gnome)
  ayatana=(libayatana-appindicator)
fi
if [ "$DESK" = kde ]; then install "${base[@]}" "${kde[@]}"; else install "${base[@]}" "${gnome[@]}"; fi
. /etc/os-release
note "$PRETTY_NAME; $(rpm -q webkit2gtk4.1 gtk3 kwin-wayland gnome-shell 2> /dev/null | tr '\n' ' ')$(pacman -Q webkit2gtk-4.1 gtk3 kwin gnome-shell 2> /dev/null | tr '\n' ' ')"
useradd -m tester
cp "$HERE"/*.py "$HERE"/*.js "$HERE"/session.sh /home/tester/
curl -fsSL -o /home/tester/Channels.AppImage "https://github.com/kiwi-init/channels/releases/download/v$VERSION/Channels-$VERSION-linux-x86_64.AppImage"
chmod +x /home/tester/Channels.AppImage
chown -R tester: /home/tester
runuser -u tester -- sh -c 'cd /home/tester && ./Channels.AppImage --appimage-extract > /dev/null' || note "the AppImage didn't extract"
APP=/home/tester/squashfs-root/AppRun

missing() {
  note "libraries the app's binaries can't find ($1):"
  for f in /home/tester/squashfs-root/bin/*.so /home/tester/squashfs-root/bin/bun /home/tester/squashfs-root/bin/electrobun-launcher; do
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
  if [ "$DESK" = kde ]; then
    runuser -u tester -- env XDG_RUNTIME_DIR="$rt" KWIN_LOG="$OUT/kwin-$tag.log" LIBGL_ALWAYS_SOFTWARE=1 QT_LOGGING_RULES='kwin_*=true;kwin_scripting.debug=true' XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=KDE KDE_FULL_SESSION=true KDE_SESSION_VERSION=6 \
      timeout 240 dbus-run-session -- kwin_wayland --virtual --width 1280 --height 800 --socket kiwi --exit-with-session "bash /home/tester/session.sh kde $OUT $tag $APP" > "$OUT/kwin-$tag.log" 2>&1
  else
    cat > "$OUT/gnome-$tag.sh" << GNOME
set -u
gsettings set org.gnome.shell introspect true
gnome-shell --headless --wayland --virtual-monitor 1280x800 --unsafe-mode > "$OUT/gnome-shell-$tag.log" 2>&1 &
shell=\$!
for _ in \$(seq 1 100); do
  [ -S "\$XDG_RUNTIME_DIR/wayland-0" ] && gdbus introspect --session --dest org.gnome.Shell --object-path /org/gnome/Shell > /dev/null 2>&1 && break
  sleep 0.3
done
sleep 3
export WAYLAND_DISPLAY=wayland-0 XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=GNOME
bash /home/tester/session.sh gnome "$OUT" "$tag" "$APP"
kill \$shell
GNOME
    chmod 644 "$OUT/gnome-$tag.sh"
    runuser -u tester -- env XDG_RUNTIME_DIR="$rt" timeout 240 dbus-run-session -- bash "$OUT/gnome-$tag.sh"
  fi
  note "session $tag exited $?"
}

missing "without libayatana-appindicator"
session no-ayatana
install "${ayatana[@]}"
missing "with libayatana-appindicator"
session with-ayatana
