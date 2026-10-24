#!/usr/bin/env bash
set -u

usage="usage: eb-wayland-start.sh ELECTROBUN_LAUNCHER (in a Wayland session: WAYLAND_DISPLAY set)"
launcher=${1:?$usage}
[ -n "${WAYLAND_DISPLAY:-}" ] || { echo "$usage" >&2; exit 2; }
home=$(mktemp -d)
out="$home/app.log"
problems=()

HOME="$home" WAYLAND_DEBUG=client setsid "$launcher" > "$out" 2>&1 &
pid=$!

toplevel=""
for _ in $(seq 1 60); do
  toplevel=$(grep -m 1 -oE 'get_toplevel\(new id xdg_toplevel[@#][0-9]+\)' "$out" 2> /dev/null || true)
  [ -n "$toplevel" ] && break
  kill -0 "$pid" 2> /dev/null || break
  sleep 0.5
done

if [ -z "$toplevel" ]; then
  problems+=("no Wayland window (xdg_toplevel) within 30s")
else
  echo "Wayland window: $(grep -oE 'xdg_toplevel[@#][0-9]+\.set_(app_id|title)\("[^"]*"\)' "$out" | sort -u | tr '\n' ' ')"
  sleep 5
  web=$(pgrep -s "$pid" -f WebKitWebProcess | head -n 1)
  [ -n "$web" ] || problems+=("no WebKitWebProcess of the app's own is running 5s after its window opened")
  if [ -n "${DISPLAY:-}" ]; then
    x11=$(xdotool search --class '^Channels$' 2> /dev/null | head -n 1)
    if [ -n "$x11" ]; then problems+=("the app also opened an X11 window ($x11) on XWayland ($DISPLAY)"); else echo "XWayland ($DISPLAY) holds no Channels window"; fi
  fi
  kill -0 "$pid" 2> /dev/null || problems+=("the app exited while its window was open")
fi

kill -TERM -- "-$pid" 2> /dev/null
for _ in $(seq 1 20); do
  pgrep -s "$pid" > /dev/null || break
  sleep 0.5
done
left=$(pgrep -s "$pid" -a || true)
if [ -n "$left" ]; then
  problems+=("still running 10s after SIGTERM: $left")
  kill -KILL -- "-$pid" 2> /dev/null
fi

if [ ${#problems[@]} -gt 0 ]; then
  echo "the app's output, without Wayland's protocol log:"
  grep -vE '^\[[ 0-9.]+\] ' "$out" | tail -n 60
  for p in "${problems[@]}"; do echo "eb-wayland-start: $p" >&2; done
  rm -rf "$home"
  exit 1
fi
if [ -n "${DISPLAY:-}" ]; then ran="though XWayland was there too"; else ran="with no X server at all"; fi
echo "the app started natively on Wayland ($WAYLAND_DISPLAY), $ran: its window is an xdg_toplevel, its web process ran, and it stopped cleanly"
rm -rf "$home"
