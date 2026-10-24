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

parent() { sed 's/.*) //' "/proc/$1/stat" 2> /dev/null | cut -d' ' -f2; }
label() { tr -d '\0' < "/proc/$1/attr/apparmor/current" 2> /dev/null || tr -d '\0' < "/proc/$1/attr/current" 2> /dev/null || echo none; }
app_processes() {
  ps -e -o pid=,ppid=,sid= | awk -v root="$pid" '
    { up[$1] = $2; sid[$1] = $3; all[NR] = $1 }
    END {
      for (i = 1; i <= NR; i++) {
        p = all[i]; mine = sid[p] == root; q = p
        while (!mine && q > 1 && (q in up)) { mine = q == root; q = up[q] }
        if (mine) print p
      }
    }'
}
bwrap_above() {
  local p
  p=$(parent "$1")
  while [ -n "$p" ] && [ "$p" -gt 1 ]; do
    [ "$(cat "/proc/$p/comm" 2> /dev/null)" = bwrap ] && { echo "$p"; return 0; }
    [ "$p" = "$pid" ] && return 1
    p=$(parent "$p")
  done
  return 1
}

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
  echo "the app's processes, with their AppArmor label:"
  webs=()
  for p in $(app_processes); do
    exe=$(readlink "/proc/$p/exe" 2> /dev/null || echo "?")
    echo "  $p (parent $(parent "$p")): $(label "$p"): $exe"
    [ "${exe##*/}" = WebKitWebProcess ] && webs+=("$p")
  done
  echo "every WebKit and bwrap process on the runner (pid ppid sid label args):"
  for p in $(pgrep -f 'WebKit|bwrap|xdg-dbus-proxy'); do echo "  $p $(parent "$p") $(ps -o sid= -p "$p" | tr -d ' ') $(label "$p") $(tr '\0' ' ' < "/proc/$p/cmdline" 2> /dev/null | cut -c1-200)"; done
  if [ ${#webs[@]} -eq 0 ]; then
    problems+=("no WebKitWebProcess of the app's own is running 5s after its window opened")
  else
    off=$(grep -h "WebKitGTK's sandbox is off" "$out" 2> /dev/null | head -n 1)
    for web in "${webs[@]}"; do
      sandbox=$(bwrap_above "$web")
      if [ -n "$sandbox" ]; then
        echo "WebKitWebProcess $web runs in bwrap $sandbox: $(tr '\0' ' ' < "/proc/$sandbox/cmdline" 2> /dev/null | cut -c1-160)"
        [ "$want" = sandboxed ] || problems+=("WebKitWebProcess $web runs in bwrap $sandbox, though here bwrap can't build the sandbox")
      else
        echo "WebKitWebProcess $web runs without bwrap: $(tr '\0' ' ' < "/proc/$web/cmdline" 2> /dev/null | cut -c1-160)"
        [ "$want" = unsandboxed ] || problems+=("WebKitWebProcess $web isn't in a bwrap of the app's own: WebKitGTK's web process isn't sandboxed${off:+ ($off)}")
      fi
    done
    if [ "$want" = unsandboxed ]; then
      if [ -n "$off" ]; then echo "the app says: $off"; else problems+=("the web process runs without the sandbox, but the app doesn't say why"); fi
    fi
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

if grep -q "navigation rules didn't take effect" "$out"; then problems+=("the rules canary wasn't reported refused on WebKitGTK, so the app quit"); fi
if grep -qE "download handler wasn't found|navigation handler wasn't found" "$out"; then problems+=("libkiwi-shell's download or navigation guard didn't install, so the app refused its window"); fi

if [ ${#problems[@]} -gt 0 ]; then
  echo "the app's output:"
  tail -n 60 "$out"
  find "$home" -name main.log -exec tail -n 20 {} + 2> /dev/null
  for p in "${problems[@]}"; do echo "eb-linux-start: $p" >&2; done
  rm -rf "$home"
  exit 1
fi
if [ "$want" = sandboxed ]; then ran="in WebKitGTK's bubblewrap sandbox"; else ran="without the sandbox bwrap can't build here, and the app says why"; fi
echo "the app started: its window's WM_CLASS is Channels (the .desktop entry's StartupWMClass), its web process ran $ran, and it stopped cleanly"
rm -rf "$home"
