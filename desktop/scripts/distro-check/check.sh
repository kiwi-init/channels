#!/usr/bin/env bash
set -u

usage="usage: check.sh fedora|arch APPIMAGE OUT [FROM_VERSION] (as root, in a privileged fedora or archlinux container)"
distro=${1:?$usage}
image=${2:?$usage}
out=${3:?$usage}
from=${4:-}
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
mkdir -p "$out/logs"
chmod -R 777 "$out"
results="$out/results.txt"
: > "$results"
chmod 666 "$results"
ok() { echo "ok   [$distro] $*" | tee -a "$results"; }
bad() { echo "FAIL [$distro] $*" | tee -a "$results"; }
info() { echo "     [$distro] $*" | tee -a "$results"; }
install() {
  if [ "$distro" = fedora ]; then
    dnf -y -q install "$@" >> "$out/logs/install.log" 2>&1
  else
    pacman -S --noconfirm --needed "$@" >> "$out/logs/install.log" 2>&1
  fi || { bad "installing $* failed: $(tail -n 3 "$out/logs/install.log" | tr '\n' ' ')"; return 1; }
}

if [ "$distro" = fedora ]; then
  stock=(gtk3 webkit2gtk4.1 librsvg2)
  tools=(weston dbus-daemon libsecret gnome-keyring kf6-kwallet python3-gobject procps-ng gcc pkgconf-pkg-config webkit2gtk4.1-devel gtk3-devel xorg-x11-server-Xvfb xvfb-run mesa-dri-drivers util-linux findutils which)
  ayatana=(libayatana-appindicator-gtk3)
else
  pacman -Syu --noconfirm >> "$out/logs/install.log" 2>&1
  stock=(gtk3 webkit2gtk-4.1 librsvg)
  tools=(weston dbus libsecret gnome-keyring kwallet python-gobject procps-ng gcc pkgconf xorg-server-xvfb mesa util-linux findutils which)
  ayatana=(libayatana-appindicator)
fi

install "${stock[@]}" || exit 1
. /etc/os-release
info "$PRETTY_NAME, with only the packages Channels names: ${stock[*]}"
extract=$(mktemp -d)
(cd "$extract" && "$image" --appimage-extract > /dev/null 2>&1)
missing=""
for f in "$extract"/squashfs-root/Channels/bin/*.so "$extract"/squashfs-root/Channels/bin/bun "$extract"/squashfs-root/Channels/bin/electrobun-launcher "$extract"/squashfs-root/Channels/bin/launcher; do
  m=$(ldd "$f" 2> /dev/null | awk '/not found/ { print $1 }' | tr '\n' ' ')
  [ -n "$m" ] && missing+="$(basename "$f"): $m; "
done
if [ -n "$missing" ]; then bad "libraries the app can't find on a stock install: $missing"; else ok "every library the app's binaries link is there on a stock install"; fi
lib="$extract/squashfs-root/Channels/bin/libkiwi-shell.so"
chmod -R a+rX "$extract"

install "${tools[@]}" || exit 1
if ldconfig -p | grep -q libayatana-appindicator3.so.1; then bad "the test tools pulled in libayatana-appindicator, so the stock start can't be checked"; fi
dbus-uuidgen --ensure=/etc/machine-id 2> /dev/null
mkdir -p /var/lib/dbus /run/dbus
[ -f /var/lib/dbus/machine-id ] || cp /etc/machine-id /var/lib/dbus/machine-id
dbus-daemon --system --fork || bad "no system bus"
sysctl -qw kernel.apparmor_restrict_unprivileged_userns=0 2> /dev/null || true
info "unprivileged user namespaces, as Fedora and Arch allow them: $(unshare -U true 2>&1 && echo allowed || echo refused)"

tests=/usr/local/libexec/kiwi-tests
mkdir -p "$tests"
for t in tray:gio-2.0 scheme:webkit2gtk-4.1 notify:gtk+-3.0; do
  name=${t%%:*}
  cc -O2 -Wall -Wextra -Werror -o "$tests/kiwi-$name-test" "$repo/desktop/native/linux/kiwi-$name-test.c" $(pkg-config --cflags --libs "${t#*:}") -ldl > "$out/logs/cc-$name.log" 2>&1 || bad "kiwi-$name-test didn't build: $(tail -n 3 "$out/logs/cc-$name.log" | tr '\n' ' ')"
done

id tester > /dev/null 2>&1 || useradd -m tester
cp "$image" /home/tester/Channels.AppImage
cp "$here/session.sh" "$here/update.sh" "$here/watcher.py" /home/tester/
chmod +x /home/tester/Channels.AppImage
chown -R tester: /home/tester

as_tester() {
  local rt
  rt=$(mktemp -d)
  chown tester: "$rt"
  chmod 700 "$rt"
  runuser -u tester -- env XDG_RUNTIME_DIR="$rt" timeout 300 dbus-run-session -- "$@"
  local code=$?
  rm -rf "$rt"
  return $code
}
session() { as_tester bash /home/tester/session.sh "$1" "$2" /home/tester/Channels.AppImage "$results" "$out/logs" "$3"; }
lib_test() {
  local name=$1
  shift
  if as_tester "$@" > "$out/logs/$name.log" 2>&1; then ok "$name: $(tail -n 1 "$out/logs/$name.log" | cut -c1-200)"; else bad "$name: $(grep -h "$name" "$out/logs/$name.log" | tail -n 3 | tr '\n' ' ' | cut -c1-300)"; fi
}

session none stock no-tray
lib_test kiwi-tray-test "$tests/kiwi-tray-test" "$lib" no-indicator
install "${ayatana[@]}" || exit 1
lib_test kiwi-tray-test "$tests/kiwi-tray-test" "$lib"
session gnome-keyring gnome-keyring tray
session kwallet kwallet tray
lib_test kiwi-scheme-test xvfb-run -a "$tests/kiwi-scheme-test" "$lib"
lib_test kiwi-notify-test xvfb-run -a "$tests/kiwi-notify-test" "$lib"
[ -z "$from" ] || as_tester bash /home/tester/update.sh "$from" "$results" "$out/logs"

chmod -R a+rX "$out"
fails=$(grep -c '^FAIL' "$results")
echo
cat "$results"
if [ "$fails" -gt 0 ]; then
  echo "$fails checks failed on $PRETTY_NAME"
  exit 1
fi
echo "every check passed on $PRETTY_NAME"
