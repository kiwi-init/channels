#!/usr/bin/env bash
set -u

usage="usage: check.sh arch APPIMAGE OUT [FROM_VERSION] (as root, in a privileged archlinux container)"
distro=${1:?$usage}
image=${2:?$usage}
out=${3:?$usage}
from=${4:-}
[ "$distro" = arch ] || { echo "$usage" >&2; exit 2; }
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
  pacman -S --noconfirm --needed "$@" >> "$out/logs/install.log" 2>&1 || { bad "installing $* failed: $(tail -n 3 "$out/logs/install.log" | tr '\n' ' ')"; return 1; }
}

pacman -Syu --noconfirm >> "$out/logs/install.log" 2>&1
stock=(gtk3 webkit2gtk-4.1 librsvg)
tools=(weston dbus libsecret gnome-keyring kwallet python-gobject procps-ng gcc pkgconf xorg-server-xvfb mesa util-linux findutils which gsettings-desktop-schemas squashfs-tools)
ayatana=(libayatana-appindicator)

install "${stock[@]}" || exit 1
. /etc/os-release
info "$PRETTY_NAME, with only the packages Channels names: ${stock[*]}"
extract=$(mktemp -d)
cp "$image" "$extract/Channels.AppImage"
chmod +x "$extract/Channels.AppImage"
(cd "$extract" && ./Channels.AppImage --appimage-extract > /dev/null 2>&1)
[ -x "$extract/squashfs-root/Channels/bin/launcher" ] || { bad "the AppImage didn't extract: no Channels/bin/launcher in it"; exit 1; }
missing=""
for f in "$extract"/squashfs-root/Channels/bin/*.so "$extract"/squashfs-root/Channels/bin/bun "$extract"/squashfs-root/Channels/bin/electrobun-launcher "$extract"/squashfs-root/Channels/bin/launcher; do
  m=$(ldd "$f" 2> /dev/null | awk '/not found/ { print $1 }' | while read -r l; do [ -e "$extract/squashfs-root/Channels/bin/$l" ] || echo "$l"; done | tr '\n' ' ')
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
info "unprivileged user namespaces, as Arch allows them: $(unshare -U true 2>&1 && echo allowed || echo refused)"

tests=/usr/local/libexec/kiwi-tests
mkdir -p "$tests"
for t in tray:gio-2.0 scheme:webkit2gtk-4.1; do
  name=${t%%:*}
  cc -O2 -Wall -Wextra -Werror -o "$tests/kiwi-$name-test" "$repo/desktop/native/linux/kiwi-$name-test.c" $(pkg-config --cflags --libs "${t#*:}") -ldl > "$out/logs/cc-$name.log" 2>&1 || bad "kiwi-$name-test didn't build: $(tail -n 3 "$out/logs/cc-$name.log" | tr '\n' ' ')"
done

id tester > /dev/null 2>&1 || useradd -m tester
input_id=$(grep -o '"identifier":"[^"]*"' "$extract/squashfs-root/Channels/Resources/version.json" 2> /dev/null | cut -d'"' -f4)
case "$input_id" in
  *.dev | *.test)
    bash "$here/release-copy.sh" "$extract/Channels.AppImage" /home/tester/Channels.AppImage com.kiwiinit.channels || bad "no release-id copy of the AppImage to check the menu entry with"
    cp "$extract/Channels.AppImage" /home/tester/Channels-dev.AppImage
    ;;
  *) cp "$extract/Channels.AppImage" /home/tester/Channels.AppImage ;;
esac
cp "$here/session.sh" "$here/update.sh" "$here/link.sh" "$here/raise.sh" "$here/browser.py" "$here/kwin.py" "$here/click.py" "$here/watcher.py" "$here/kwallet-login.py" "$here/secrets-cancel.py" /home/tester/
chmod +x /home/tester/*.AppImage
chown -R tester: /home/tester

as_tester() {
  local rt
  rt=$(mktemp -d)
  chown tester: "$rt"
  chmod 700 "$rt"
  runuser -u tester -- env XDG_RUNTIME_DIR="$rt" timeout 900 dbus-run-session -- "$@"
  local code=$?
  rm -rf "$rt"
  return $code
}
session() { as_tester bash /home/tester/session.sh "$1" "$2" "${app:-/home/tester/Channels.AppImage}" "$results" "$out/logs" "$3" "${4:-}" "${5:-extract}"; }
entry_check() {
  local home=$1 want=$2 file="$1/.local/share/applications/channels-desktop.desktop" exec icons handler
  [ -f "$file" ] || { bad "no desktop entry at $file after a start"; return; }
  exec=$(sed -n 's/^Exec=//p' "$file")
  if [ "$exec" = "$want" ]; then ok "the app wrote its desktop entry: Exec=$exec"; else bad "the desktop entry's Exec is '$exec', not '$want'"; fi
  icons=$(find "$home/.local/share/icons/hicolor" -name channels-desktop.png 2> /dev/null | wc -l)
  if [ "$icons" -gt 0 ]; then ok "and $icons hicolor icons for it"; else bad "no hicolor icons for the desktop entry"; fi
  handler=$(runuser -u tester -- env HOME="$home" gio mime x-scheme-handler/kiwi 2>&1 | head -n 1)
  case "$handler" in *channels-desktop.desktop*) ok "kiwi:// links open it: $handler" ;; *) bad "kiwi:// doesn't open channels-desktop.desktop: $handler" ;; esac
}
mounted() {
  if grep -q "$2" "$out/logs/$1-procs.log"; then ok "$3"; else bad "$3 didn't happen, the app's processes: $(head -n 4 "$out/logs/$1-procs.log" | tr '\n' ';' | cut -c1-300)"; fi
}
lib_test() {
  local name=$1
  shift
  if as_tester "$@" > "$out/logs/$name.log" 2>&1; then ok "$name: $(tail -n 1 "$out/logs/$name.log" | cut -c1-200)"; else bad "$name: $(grep -h "$name" "$out/logs/$name.log" | tail -n 3 | tr '\n' ' ' | cut -c1-300)"; fi
}

plain_home=$(runuser -u tester -- mktemp -d)
activatable=$(grep -lE 'org\.freedesktop\.secrets|org\.gnome\.keyring' /usr/share/dbus-1/services/*.service 2> /dev/null)
for f in $activatable; do mv "$f" "$f.off"; done
if ls /usr/bin/fusermount* > /dev/null 2>&1; then bad "the test tools pulled in FUSE, so the start without it can't be checked"; fi
session none stock no-tray "$plain_home"
if [ -e /home/tester/Channels-dev.AppImage ]; then
  dev_home=$(runuser -u tester -- mktemp -d)
  app=/home/tester/Channels-dev.AppImage session none dev-build no-tray "$dev_home"
  if [ -e "$dev_home/.local/share/applications/channels-desktop.desktop" ]; then bad "a dev build wrote the app menu's entry (#1806)"; else ok "a dev build leaves the app menu's entry alone (#1806)"; fi
else
  info "the input is ${input_id:-a build whose version.json names no identifier}, not a dev or test build, so the #1806 dev-build check doesn't apply"
fi
entry_check "$plain_home" 'env APPIMAGE_EXTRACT_AND_RUN=1 "/home/tester/Channels.AppImage" %U'
session none entry-no-fuse no-tray "$plain_home" entry
mounted entry-no-fuse /tmp/appimage_extracted_ "with no FUSE, the entry's start extracts the AppImage and runs it"
for f in $activatable; do mv "$f.off" "$f"; done
lib_test kiwi-tray-test "$tests/kiwi-tray-test" "$lib" no-indicator
install "${ayatana[@]}" || exit 1
sealed_home=$(runuser -u tester -- mktemp -d)
session gnome-keyring gnome-keyring tray "$sealed_home"
install hunspell hunspell-en_us || exit 1
session kwallet kwallet tray
session gnome-keyring migrate tray "$plain_home"
session kwallet-unanswered kwallet-unanswered tray
session cancel cancel-locked-first-run tray
session cancel-no-keyring cancel-no-keyring-first-run tray
session cancel-holds-key cancel-sealed tray "$sealed_home"
session cancel keyless-dialog tray "$sealed_home"
lib_test kiwi-scheme-test xvfb-run -a "$tests/kiwi-scheme-test" "$lib"
install fuse3 || exit 1
fuse_home=$(runuser -u tester -- mktemp -d)
session gnome-keyring fuse tray "$fuse_home"
entry_check "$fuse_home" '"/home/tester/Channels.AppImage" %U'
session gnome-keyring entry-fuse tray "$fuse_home" entry
mounted entry-fuse /tmp/.mount_ "with fuse3, the entry's start mounts the AppImage"
install xdg-utils kde-cli-tools firefox || exit 1
as_tester bash /home/tester/link.sh "$fuse_home" "$results" "$out/logs"
raise_check() {
  local code raised
  as_tester bash /home/tester/raise.sh "$fuse_home" "$results" "$out/logs"
  code=$?
  [ "$code" -eq 0 ] || bad "raise.sh stopped with status $code$([ "$code" -eq 124 ] && echo ", its 900 s timeout")"
  raised=$(grep -c '^ok   \[raise\]' "$results")
  [ "$raised" -eq 2 ] || bad "raise.sh proved $raised of its 2 raises (xdg-open and gio)"
}
install kwin python-pywayland plasma-wayland-protocols && raise_check
if [ -n "$from" ]; then
  as_tester bash /home/tester/update.sh "$from" "$results" "$out/logs"
  entry_check /home/tester '"/home/tester/Applications/Channels.AppImage" %U'
  as_tester bash /home/tester/link.sh /home/tester "$results" "$out/logs" updated
fi

chmod -R a+rX "$out"
fails=$(grep -c '^FAIL' "$results")
echo
cat "$results"
if [ "$fails" -gt 0 ]; then
  echo "$fails checks failed on $PRETTY_NAME"
  exit 1
fi
echo "every check passed on $PRETTY_NAME"
