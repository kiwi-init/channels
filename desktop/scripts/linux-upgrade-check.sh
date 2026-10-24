#!/usr/bin/env bash
set -eo pipefail

usage="usage: linux-upgrade-check.sh DIR"
dir=${1:?$usage}
cd "$dir"

old="${RUNNER_TEMP:-$(mktemp -d)}/old.deb"
curl -fsSL -o "$old" https://github.com/kiwi-init/channels/releases/download/v0.26.0/Channels-0.26.0-linux-amd64.deb
echo "0fb7656f63f14c5f802b71d6c6f255a13404a73455b407d7f8bb0c05e0b729f2  $old" | sha256sum -c -
sudo apt-get install -y --no-install-recommends "$old"
[ "$(readlink -f /usr/bin/channels-desktop)" = /opt/Channels/channels-desktop ] || { echo "the Electron deb didn't make its link"; exit 1; }
sudo apt-get install -y --no-install-recommends libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 librsvg2-2 bubblewrap xdg-dbus-proxy
sudo dpkg -i "$(ls Channels-*-linux-amd64.deb)"
link=$(readlink -f /usr/bin/channels-desktop || true)
[ "$link" = /opt/Channels/bin/launcher ] || { echo "after the upgrade /usr/bin/channels-desktop is '$link', not /opt/Channels/bin/launcher"; exit 1; }
[ ! -e /opt/Channels/channels-desktop ] || { echo "the Electron app is still in /opt/Channels"; exit 1; }
grep -qx 'Exec=/opt/Channels/bin/launcher %U' /usr/share/applications/channels-desktop.desktop || { echo "the installed entry doesn't run /opt/Channels/bin/launcher"; exit 1; }
verify=$(dpkg --verify kiwi-desktop || true)
[ -z "$verify" ] || { echo "dpkg --verify kiwi-desktop:"; echo "$verify"; exit 1; }
echo "upgraded: $(dpkg-query -W kiwi-desktop), /usr/bin/channels-desktop -> $link"
echo "for WebKitGTK's sandbox: kernel.apparmor_restrict_unprivileged_userns=$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo unset), unshare -U as a user: $(unshare -U true 2>&1 && echo allowed || echo refused)"
rm "$old"
