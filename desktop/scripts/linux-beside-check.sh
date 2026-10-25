#!/usr/bin/env bash
set -eo pipefail

usage="usage: linux-beside-check.sh DIR"
dir=${1:?$usage}
cd "$dir"

stable="${RUNNER_TEMP:-$(mktemp -d)}/stable.deb"
curl -fsSL -o "$stable" https://github.com/kiwi-init/channels/releases/download/v0.26.0/Channels-0.26.0-linux-amd64.deb
echo "0fb7656f63f14c5f802b71d6c6f255a13404a73455b407d7f8bb0c05e0b729f2  $stable" | sha256sum -c -
sudo apt-get install -y --no-install-recommends "$stable"
[ "$(readlink -f /usr/bin/channels-desktop)" = /opt/Channels/channels-desktop ] || { echo "stable's deb didn't make its link"; exit 1; }
before=$(cd /opt/Channels && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum)
sudo apt-get install -y --no-install-recommends libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 librsvg2-2 bubblewrap xdg-dbus-proxy
sudo dpkg -i "$(ls Channels-*-linux-amd64.deb)"
dpkg-query -W kiwi-desktop channels-livewire
[ "$(readlink -f /usr/bin/channels-desktop)" = /opt/Channels/channels-desktop ] || { echo "installing Channels Livewire moved stable's /usr/bin/channels-desktop"; exit 1; }
after=$(cd /opt/Channels && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum)
[ "$before" = "$after" ] || { echo "installing Channels Livewire changed stable's /opt/Channels"; exit 1; }
link=$(readlink -f /usr/bin/channels-livewire || true)
[ "$link" = /opt/ChannelsLivewire/bin/launcher ] || { echo "/usr/bin/channels-livewire is '$link', not /opt/ChannelsLivewire/bin/launcher"; exit 1; }
entry=/usr/share/applications/channels-livewire.desktop
grep -qx 'Exec=/opt/ChannelsLivewire/bin/launcher %U' "$entry" || { echo "$entry doesn't run /opt/ChannelsLivewire/bin/launcher"; exit 1; }
grep -qx 'Name=Channels Livewire' "$entry" || { echo "$entry isn't named Channels Livewire"; exit 1; }
! grep -q 'x-scheme-handler/kiwi' "$entry" || { echo "$entry opens kiwi:// links, which stay stable Channels'"; exit 1; }
for p in kiwi-desktop channels-livewire; do
  verify=$(dpkg --verify "$p" || true)
  [ -z "$verify" ] || { echo "dpkg --verify $p:"; echo "$verify"; exit 1; }
done
sudo dpkg --purge kiwi-desktop
[ "$(readlink -f /usr/bin/channels-livewire)" = /opt/ChannelsLivewire/bin/launcher ] && [ -e "$entry" ] || { echo "removing stable Channels took Channels Livewire's link or entry with it"; exit 1; }
verify=$(dpkg --verify channels-livewire || true)
[ -z "$verify" ] || { echo "after removing stable, dpkg --verify channels-livewire:"; echo "$verify"; exit 1; }
echo "beside stable: $(dpkg-query -W channels-livewire) in /opt/ChannelsLivewire, /usr/bin/channels-livewire -> $link; stable's files and link untouched, and removing stable leaves it whole"
echo "for WebKitGTK's sandbox: kernel.apparmor_restrict_unprivileged_userns=$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo unset), unshare -U as a user: $(unshare -U true 2>&1 && echo allowed || echo refused)"
rm "$stable"
