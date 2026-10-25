#!/usr/bin/env bash
set -eo pipefail

usage="usage: linux-packages-check.sh DIR"
dir=${1:?$usage}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$dir"

bun "$here/appimage-squashfs.ts" .
deb=$(ls Channels-*-linux-amd64.deb)
dpkg-deb --field "$deb" Package Version Architecture Depends
files=$(dpkg-deb --contents "$deb")
for p in ./opt/ChannelsLivewire/bin/launcher ./opt/ChannelsLivewire/bin/electrobun-launcher ./opt/ChannelsLivewire/bin/cottontail ./opt/ChannelsLivewire/Resources/kiwi.js ./opt/ChannelsLivewire/Resources/app/bun/index.js ./opt/ChannelsLivewire/Resources/app/bun/keys.js ./opt/ChannelsLivewire/Resources/app/page/index.html ./opt/ChannelsLivewire/Resources/app/views/internal/assets ./usr/bin/channels-livewire ./usr/share/applications/channels-livewire.desktop ./usr/share/icons/hicolor/512x512/apps/channels-livewire.png; do
  [[ "$files" == *" $p"* ]] || { echo "$deb lacks $p"; exit 1; }
done
for p in ./opt/ChannelsLivewire/bin/bspatch ./opt/ChannelsLivewire/bin/zig-zstd ./opt/ChannelsLivewire/Resources/uninstall ./opt/ChannelsLivewire/ChannelsLivewire.desktop ./opt/ChannelsLivewire/Resources/app/views/internal/index.html; do
  [[ "$files" != *" $p"* ]] || { echo "$deb carries $p, which it leaves out"; exit 1; }
done
img=$(ls Channels-*-linux-x86_64.AppImage)
"./$img" --appimage-extract > /dev/null
for p in AppRun channels-livewire.desktop channels-livewire.png ChannelsLivewire/bin/launcher ChannelsLivewire/bin/electrobun-launcher ChannelsLivewire/bin/cottontail ChannelsLivewire/Resources/kiwi.js ChannelsLivewire/Resources/app/bun/index.js ChannelsLivewire/Resources/app/bun/keys.js ChannelsLivewire/Resources/app/page/index.html ChannelsLivewire/Resources/app/views/internal/assets; do
  [ -e "squashfs-root/$p" ] || { echo "$img lacks $p"; exit 1; }
done
for p in ChannelsLivewire/bin/bspatch ChannelsLivewire/bin/zig-zstd ChannelsLivewire/Resources/uninstall ChannelsLivewire/ChannelsLivewire.desktop ChannelsLivewire/Resources/app/views/internal/index.html; do
  [ ! -e "squashfs-root/$p" ] || { echo "$img carries $p, which it leaves out"; exit 1; }
done
! grep -q 'x-scheme-handler/kiwi' squashfs-root/channels-livewire.desktop || { echo "$img's entry opens kiwi:// links, which stay stable Channels'"; exit 1; }
probe=$(mktemp -d)
cp squashfs-root/ChannelsLivewire/bin/launcher "$probe/launcher"
printf '#include <stdio.h>\nextern char **environ;\nint main(void) { for (char **e = environ; *e; e++) puts(*e); return 0; }\n' > "$probe/env.c"
cc -O2 -o "$probe/electrobun-launcher" "$probe/env.c"
seen=$(env -i HOME=/home/ana DISPLAY=:0 LD_PRELOAD=/tmp/evil.so LD_LIBRARY_PATH=. BUN_OPTIONS=--preload=/tmp/evil.ts NODE_OPTIONS=--require=/tmp/evil.js GTK_MODULES=evil XDG_RUNTIME_DIR=/run/user/1000 "$probe/launcher")
want=$(printf 'HOME=/home/ana\nDISPLAY=:0\nXDG_RUNTIME_DIR=/run/user/1000\nBUN_RUNTIME_TRANSPILER_CACHE_PATH=0')
[ "$seen" = "$want" ] || { echo "the built bin/launcher passed on:"; echo "$seen"; exit 1; }
seen=$(env -i HOME=/home/ana WAYLAND_DISPLAY=wayland-0 XDG_ACTIVATION_TOKEN=kwin-42 "$probe/launcher")
want=$(printf 'HOME=/home/ana\nWAYLAND_DISPLAY=wayland-0\nXDG_ACTIVATION_TOKEN=kwin-42\nDESKTOP_STARTUP_ID=kwin-42\nBUN_RUNTIME_TRANSPILER_CACHE_PATH=0')
[ "$seen" = "$want" ] || { echo "with only XDG_ACTIVATION_TOKEN (as Plasma launches), bin/launcher passed on:"; echo "$seen"; exit 1; }
seen=$(env -i HOME=/home/ana DESKTOP_STARTUP_ID=gnome-7_TIME99 XDG_ACTIVATION_TOKEN=gnome-7_TIME99 "$probe/launcher")
want=$(printf 'HOME=/home/ana\nDESKTOP_STARTUP_ID=gnome-7_TIME99\nXDG_ACTIVATION_TOKEN=gnome-7_TIME99\nBUN_RUNTIME_TRANSPILER_CACHE_PATH=0')
[ "$seen" = "$want" ] || { echo "with both launch tokens (as GLib launches), bin/launcher passed on:"; echo "$seen"; exit 1; }
seen=$(env -i HOME=/home/ana DESKTOP_STARTUP_ID= XDG_ACTIVATION_TOKEN=kwin-43 "$probe/launcher")
want=$(printf 'HOME=/home/ana\nXDG_ACTIVATION_TOKEN=kwin-43\nDESKTOP_STARTUP_ID=kwin-43\nBUN_RUNTIME_TRANSPILER_CACHE_PATH=0')
[ "$seen" = "$want" ] || { echo "with an empty DESKTOP_STARTUP_ID and a Wayland token, bin/launcher passed on:"; echo "$seen"; exit 1; }
rm -rf "$probe" squashfs-root
echo "checked: $deb and $img; bin/launcher keeps the app's environment to its allowlist and gives GTK the launch token as DESKTOP_STARTUP_ID"
