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
for p in ./opt/Channels/bin/launcher ./opt/Channels/bin/electrobun-launcher ./opt/Channels/bin/bun ./opt/Channels/Resources/kiwi.js ./opt/Channels/Resources/app/bun/index.js ./opt/Channels/Resources/app/bun/keys.js ./opt/Channels/Resources/app/page/index.html ./opt/Channels/Resources/app/views/internal/assets ./usr/bin/channels-desktop ./usr/share/applications/channels-desktop.desktop ./usr/share/icons/hicolor/512x512/apps/channels-desktop.png; do
  [[ "$files" == *" $p"* ]] || { echo "$deb lacks $p"; exit 1; }
done
for p in ./opt/Channels/bin/bspatch ./opt/Channels/bin/zig-zstd ./opt/Channels/Resources/uninstall ./opt/Channels/Channels.desktop ./opt/Channels/Resources/app/views/internal/index.html; do
  [[ "$files" != *" $p"* ]] || { echo "$deb carries $p, which it leaves out"; exit 1; }
done
img=$(ls Channels-*-linux-x86_64.AppImage)
"./$img" --appimage-extract > /dev/null
for p in AppRun channels-desktop.desktop channels-desktop.png Channels/bin/launcher Channels/bin/electrobun-launcher Channels/bin/bun Channels/Resources/kiwi.js Channels/Resources/app/bun/index.js Channels/Resources/app/bun/keys.js Channels/Resources/app/page/index.html Channels/Resources/app/views/internal/assets; do
  [ -e "squashfs-root/$p" ] || { echo "$img lacks $p"; exit 1; }
done
for p in Channels/bin/bspatch Channels/bin/zig-zstd Channels/Resources/uninstall Channels/Channels.desktop Channels/Resources/app/views/internal/index.html; do
  [ ! -e "squashfs-root/$p" ] || { echo "$img carries $p, which it leaves out"; exit 1; }
done
probe=$(mktemp -d)
cp squashfs-root/Channels/bin/launcher "$probe/launcher"
printf '#include <stdio.h>\nextern char **environ;\nint main(void) { for (char **e = environ; *e; e++) puts(*e); return 0; }\n' > "$probe/env.c"
cc -O2 -o "$probe/electrobun-launcher" "$probe/env.c"
seen=$(env -i HOME=/home/ana DISPLAY=:0 LD_PRELOAD=/tmp/evil.so LD_LIBRARY_PATH=. BUN_OPTIONS=--preload=/tmp/evil.ts NODE_OPTIONS=--require=/tmp/evil.js GTK_MODULES=evil XDG_RUNTIME_DIR=/run/user/1000 "$probe/launcher")
want=$(printf 'HOME=/home/ana\nDISPLAY=:0\nXDG_RUNTIME_DIR=/run/user/1000\nBUN_RUNTIME_TRANSPILER_CACHE_PATH=0')
[ "$seen" = "$want" ] || { echo "the built bin/launcher passed on:"; echo "$seen"; exit 1; }
rm -rf "$probe" squashfs-root
echo "checked: $deb and $img; bin/launcher keeps the app's environment to its allowlist"
