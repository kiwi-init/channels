#!/usr/bin/env bash
set -u

usage="usage: eb-linux-start.sh LAUNCHER sandboxed|unsandboxed [ARG...]"
launcher=${1:?$usage}
want=${2:?$usage}
[ "$want" = sandboxed ] || [ "$want" = unsandboxed ] || { echo "$usage" >&2; exit 2; }
shift 2
home=$(mktemp -d)
out="$home/app.log"
problems=()

HOME="$home" setsid "$launcher" "$@" > "$out" 2>&1 &
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
  eval "$(xdotool getwindowgeometry --shell "$win")"
  read -r sw sh < <(xdotool getdisplaygeometry)
  if [ "$WIDTH" -gt $((sw * 9 / 10)) ] || [ "$HEIGHT" -gt $((sh * 9 / 10)) ] || [ "$WIDTH" -lt 720 ] || [ "$HEIGHT" -lt 480 ]; then
    problems+=("the window opened at ${WIDTH}x${HEIGHT} on a ${sw}x${sh} screen, not within 90% of it and at least 720x480")
  else
    echo "window size: ${WIDTH}x${HEIGHT} on a ${sw}x${sh} screen"
  fi
  web=$(pgrep -s "$pid" -f WebKitWebProcess | head -n 1)
  if [ -z "$web" ]; then
    problems+=("no WebKitWebProcess of the app's own is running 5s after its window opened")
  else
    echo "WebKitWebProcess $web: $(tr '\0' ' ' < "/proc/$web/cmdline" | cut -c1-160)"
    sandbox=""
    up=$web
    while [ -n "$up" ] && [ "$up" -gt 1 ] && [ "$up" != "$pid" ]; do
      up=$(ps -o ppid= -p "$up" | tr -d ' ')
      if [ -n "$up" ] && [ "$(ps -o comm= -p "$up")" = bwrap ]; then
        sandbox="$up $(tr '\0' ' ' < "/proc/$up/cmdline" | cut -c1-400)"
        break
      fi
    done
    others=$(pgrep -s "$pid" -a bwrap | cut -c1-400)
    [ -z "$others" ] || echo "bwrap in the app's session: $others"
    tree=$(ps -e -o pid=,ppid=,sid=,args= --forest | grep -E "bwrap|WebKit|xdg-dbus-proxy|glycin|launcher|/bun " | grep -v grep | cut -c1-300)
    off=$(grep -h "WebKitGTK's sandbox is off" "$out" 2> /dev/null | head -n 1)
    if [ "$want" = sandboxed ]; then
      if [ -n "$sandbox" ]; then echo "sandbox: $sandbox"; else problems+=("no bwrap of the app's own: WebKitGTK's web process isn't sandboxed${off:+ ($off)}"); fi
    else
      [ -z "$sandbox" ] || problems+=("bwrap runs ($sandbox), though here it can't build the sandbox")
      if [ -n "$off" ]; then echo "the app says: $off"; else problems+=("the web process runs without the sandbox, but the app doesn't say why"); fi
    fi
  fi
  kill -0 "$pid" 2> /dev/null || problems+=("the app exited while its window was open")
  b=$(pgrep -s "$pid" -x bun | head -n 1)
  if [ "$want" = sandboxed ] && [ -n "$b" ] && [ "$launcher" = /opt/Channels/bin/launcher ]; then
    kept_env="$home.env"
    tr '\0' '\n' < "/proc/$b/environ" | grep -v '^HOME=' > "$kept_env"
  fi
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

if grep -q "navigation rules didn't take effect" "$out"; then problems+=("the rules canary wasn't reported refused on WebKitGTK, so the app quit"); fi
if grep -qE "download handler wasn't found|navigation handler wasn't found" "$out"; then problems+=("libkiwi-shell's download or navigation guard didn't install, so the app refused its window"); fi

boxed_with() {
  local h p ok=no w up
  h=$(mktemp -d)
  env -i "$@" HOME="$h" setsid /opt/Channels/bin/electrobun-launcher > "$h/out" 2>&1 &
  p=$!
  sleep 9
  for w in $(pgrep -s "$p" -f WebKitWebProcess); do
    up=$w
    while [ -n "$up" ] && [ "$up" -gt 1 ] && [ "$up" != "$p" ]; do
      up=$(ps -o ppid= -p "$up" | tr -d ' ')
      [ -n "$up" ] && [ "$(ps -o comm= -p "$up")" = bwrap ] && ok=yes
    done
  done
  kill -TERM -- "-$p" 2> /dev/null
  sleep 2
  kill -KILL -- "-$p" 2> /dev/null
  rm -rf "$h"
  [ "$ok" = yes ]
}
if [ -n "${kept_env:-}" ]; then
  mapfile -t kept < "$kept_env"
  mapfile -t dropped < <(env | grep -v '^HOME=' | while IFS= read -r line; do n=${line%%=*}; grep -q "^$n=" "$kept_env" || printf '%s\n' "$line"; done)
  echo "kiwi-probe: ${#kept[@]} kept, ${#dropped[@]} dropped: $(printf '%s ' "${dropped[@]%%=*}")"
  if boxed_with "${kept[@]}"; then echo "kiwi-probe: kept only: sandboxed"; else echo "kiwi-probe: kept only: not sandboxed"; fi
  if boxed_with "${kept[@]}" "${dropped[@]}"; then echo "kiwi-probe: kept + all dropped: sandboxed"; else echo "kiwi-probe: kept + all dropped: not sandboxed"; fi
  set_=("${dropped[@]}")
  while [ ${#set_[@]} -gt 1 ]; do
    half=$(( ${#set_[@]} / 2 ))
    a=("${set_[@]:0:$half}")
    b=("${set_[@]:$half}")
    if boxed_with "${kept[@]}" "${a[@]}"; then set_=("${a[@]}"); elif boxed_with "${kept[@]}" "${b[@]}"; then set_=("${b[@]}"); else echo "kiwi-probe: neither half alone sandboxes: $(printf '%s ' "${set_[@]%%=*}")"; break; fi
    echo "kiwi-probe: narrowed to ${#set_[@]}: $(printf '%s ' "${set_[@]%%=*}" | cut -c1-300)"
  done
  echo "kiwi-probe: result: $(printf '%s | ' "${set_[@]}" | cut -c1-400)"
fi

if [ ${#problems[@]} -gt 0 ]; then
  echo "the app's output:"
  [ -z "${tree:-}" ] || printf 'its processes (pid, parent, session):\n%s\n' "$tree"
  tail -n 60 "$out"
  find "$home" -name main.log -exec tail -n 20 {} + 2> /dev/null
  for p in "${problems[@]}"; do echo "eb-linux-start: $p" >&2; done
  rm -rf "$home"
  exit 1
fi
if [ "$want" = sandboxed ]; then ran="in WebKitGTK's bubblewrap sandbox"; else ran="without the sandbox bwrap can't build here, and the app says why"; fi
echo "the app started: its window's WM_CLASS is Channels (the .desktop entry's StartupWMClass), its web process ran $ran, and it stopped cleanly"
rm -rf "$home"
