#!/usr/bin/env bash
set -euo pipefail

TMUX_VERSION=3.8
TMUX_SHA=e79c699c7e949dccd0a4a125e17b8d1261e311b16979dbc8eb34542f3966d82e
LIBEVENT_VERSION=2.1.13-stable
LIBEVENT_SHA=f7e9383b8c0baa81b687e5b5eecc01beefaf1b19b64151d95ed61647fe7a315c
NCURSES_VERSION=6.6
NCURSES_SHA=355b4cbbed880b0381a04c46617b7656e362585d52e9cf84a67e2009b749ff11
UTF8PROC_VERSION=2.12.0
UTF8PROC_SHA=f564011d38b2888d583d510b08e69ffa15aa117155db1b9b49ef1dfe1fa25111
MACOS_MIN=12.0

out=${1:?"usage: scripts/build-tmux.sh OUT, where tmux $TMUX_VERSION goes, linked only to libraries every computer has"}
case "$out" in /*) ;; *) out="$PWD/$out" ;; esac
os=$(uname -s)
jobs=$( (command -v nproc > /dev/null && nproc) || sysctl -n hw.ncpu)
work=$(mktemp -d "${TMPDIR:-/tmp}/kiwi-tmux.XXXXXX")
trap 'rm -rf "$work"' EXIT
prefix="$work/prefix"
mkdir -p "$prefix/include" "$prefix/lib"

case "$os" in
  Darwin)
    export MACOSX_DEPLOYMENT_TARGET=$MACOS_MIN
    flags="-O2 -mmacosx-version-min=$MACOS_MIN"
    ;;
  Linux) flags="-O2" ;;
  *)
    echo "build-tmux: no tmux build for $os" >&2
    exit 1
    ;;
esac

fetch() {
  local url=$1 sha=$2 file
  file="$work/$(basename "$url")"
  curl -fsSL --retry 3 -o "$file" "$url"
  local got
  got=$( (command -v sha256sum > /dev/null && sha256sum "$file") || shasum -a 256 "$file")
  [ "${got%% *}" = "$sha" ] || {
    echo "build-tmux: $url has sha256 ${got%% *}, not the pinned $sha" >&2
    exit 1
  }
  tar -xf "$file" -C "$work"
}

fetch "https://github.com/libevent/libevent/releases/download/release-$LIBEVENT_VERSION/libevent-$LIBEVENT_VERSION.tar.gz" "$LIBEVENT_SHA"
(
  cd "$work/libevent-$LIBEVENT_VERSION"
  ./configure --prefix="$prefix" --disable-shared --enable-static --disable-openssl --disable-samples --disable-libevent-regress --disable-debug-mode CFLAGS="$flags" > /dev/null
  make -j"$jobs" > /dev/null
  make install > /dev/null
)

if [ "$os" = Linux ]; then
  fetch "https://ftp.gnu.org/gnu/ncurses/ncurses-$NCURSES_VERSION.tar.gz" "$NCURSES_SHA"
  (
    cd "$work/ncurses-$NCURSES_VERSION"
    ./configure --prefix="$prefix" --without-shared --with-termlib --disable-widec --without-cxx --without-cxx-binding --without-ada --without-progs --without-tests --without-manpages --without-gpm --disable-db-install --disable-pc-files \
      --with-terminfo-dirs=/etc/terminfo:/lib/terminfo:/usr/share/terminfo:/usr/lib/terminfo --with-default-terminfo-dir=/usr/share/terminfo CFLAGS="$flags" > /dev/null
    make -j"$jobs" > /dev/null
    make install > /dev/null
  )
  extra=(--disable-utf8proc --disable-jemalloc)
else
  fetch "https://github.com/JuliaStrings/utf8proc/archive/refs/tags/v$UTF8PROC_VERSION.tar.gz" "$UTF8PROC_SHA"
  (
    cd "$work/utf8proc-$UTF8PROC_VERSION"
    make -j"$jobs" libutf8proc.a CFLAGS="$flags" > /dev/null
    cp utf8proc.h "$prefix/include/"
    cp libutf8proc.a "$prefix/lib/"
  )
  extra=(--enable-utf8proc --disable-jemalloc)
fi

fetch "https://github.com/tmux/tmux/releases/download/$TMUX_VERSION/tmux-$TMUX_VERSION.tar.gz" "$TMUX_SHA"
(
  cd "$work/tmux-$TMUX_VERSION"
  ./configure --disable-dependency-tracking "${extra[@]}" PKG_CONFIG=false CFLAGS="$flags" CPPFLAGS="-I$prefix/include" LDFLAGS="$flags -L$prefix/lib" > /dev/null
  make -j"$jobs" > /dev/null
)
bin="$work/tmux-$TMUX_VERSION/tmux"

if [ "$os" = Darwin ]; then
  libs=$(otool -L "$bin" | tail -n +2 | awk '{print $1}')
  theirs=$(grep -v -E '^/usr/lib/|^/System/' <<< "$libs" || true)
else
  libs=$(readelf -d "$bin" | awk '/\(NEEDED\)/ {gsub(/[][]/, "", $NF); print $NF}')
  theirs=$(grep -v -E '^(libc|libm|libresolv|libutil|libpthread|libdl|ld-linux[^ ]*)\.so' <<< "$libs" || true)
fi
[ -z "$theirs" ] || {
  echo "build-tmux: tmux links libraries a computer may not have: $theirs" >&2
  exit 1
}
said=$("$bin" -V)
[ "$said" = "tmux $TMUX_VERSION" ] || {
  echo "build-tmux: the build says \"$said\", not tmux $TMUX_VERSION" >&2
  exit 1
}
sock_dir=$(mktemp -d /tmp/kiwi-tmux-check.XXXXXX)
sock="$sock_dir/s"
printf 'set -s exit-empty off\n' > "$sock_dir/conf"
"$bin" -S "$sock" -f "$sock_dir/conf" new-session -d -s check -x 80 -y 24 'printf "kiwi-%s\n" ok; exec sleep 30'
sleep 1
screen=$("$bin" -S "$sock" capture-pane -p -t check || true)
"$bin" -S "$sock" kill-server || true
rm -rf "$sock_dir"
grep -q "kiwi-ok" <<< "$screen" || {
  echo "build-tmux: the build didn't run a session and show its screen" >&2
  exit 1
}
mkdir -p "$(dirname "$out")"
install -m 0755 "$bin" "$out"
echo "built $out: $said, $(wc -c < "$out" | tr -d ' ') bytes, links only $(tr '\n' ' ' <<< "$libs")"
