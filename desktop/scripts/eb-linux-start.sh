#!/usr/bin/env bash
set -u

launcher=${1:?usage: eb-linux-start.sh LAUNCHER}
home=$(mktemp -d)
out="$home/app.log"
problems=()

HOME="$home" setsid "$launcher" > "$out" 2>&1 &
pid=$!

win=""
for _ in $(seq 1 60); do
  win=$(xdotool search --class '^Channels$' 2> /dev/null | head -n 1)
  [ -n "$win" ] && break
  kill -0 "$pid" 2> /dev/null || break
  sleep 0.5
done

if [ -z "$win" ]; then
  problems+=("no window with WM_CLASS Channels within 30s")
else
  class=$(xprop -id "$win" WM_CLASS)
  name=$(xprop -id "$win" _NET_WM_NAME)
  echo "window: $class; $name"
  [ "$class" = 'WM_CLASS(STRING) = "Channels", "Channels"' ] || problems+=("the window's $class isn't Channels, Channels (the .desktop entry's StartupWMClass)")
  [[ "$name" == *'"Channels"'* ]] || problems+=("the window is titled $name, not Channels")
  sleep 5
  web=$(pgrep -s "$pid" -f WebKitWebProcess | head -n 1)
  if [ -z "$web" ]; then
    problems+=("no WebKitWebProcess of the app's own is running 5s after its window opened")
  else
    echo "WebKitWebProcess $web: $(tr '\0' ' ' < "/proc/$web/cmdline" | cut -c1-160)"
    sandbox=$(pgrep -s "$pid" -a bwrap | head -n 1 | cut -c1-160)
    if [ -n "$sandbox" ]; then echo "sandbox: $sandbox"; else problems+=("no bwrap of the app's own: WebKitGTK's web process isn't sandboxed"); fi
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
  echo "the app's output:"
  tail -n 60 "$out"
  for p in "${problems[@]}"; do echo "eb-linux-start: $p" >&2; done
  rm -rf "$home"
  exit 1
fi
echo "the app started: its window's WM_CLASS is Channels (the .desktop entry's StartupWMClass), its web process ran in WebKitGTK's bubblewrap sandbox, and it stopped cleanly"
rm -rf "$home"
