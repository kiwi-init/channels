#!/usr/bin/env bash
set -u

usage="usage: linux-kwallet-check.sh (on Linux with ksecretd, KWallet 6, python3 and bun; it starts its own session bus)"
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)

if [ -z "${KIWI_KWALLET_SESSION:-}" ]; then
  [ "$(uname -s)" = Linux ] || { echo "$usage" >&2; exit 2; }
  wallet_home=$(mktemp -d)
  runtime=$(mktemp -d)
  chmod 700 "$runtime"
  env -u XDG_CONFIG_HOME -u XDG_DATA_HOME -u XDG_CACHE_HOME -u GNOME_KEYRING_CONTROL \
    HOME="$wallet_home" XDG_RUNTIME_DIR="$runtime" QT_QPA_PLATFORM=offscreen \
    XDG_CURRENT_DESKTOP=KDE KDE_FULL_SESSION=true KDE_SESSION_VERSION=6 KIWI_KWALLET_SESSION=1 \
    dbus-run-session -- bash "$0" "$@"
  code=$?
  rm -rf "$wallet_home" "$runtime"
  exit "$code"
fi

failed=0
ok() { echo "ok    $*"; }
bad() { echo "FAIL  $*"; failed=1; }
info() { echo "      $*"; }
bus() { gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method "org.freedesktop.DBus.$1" "$2" 2> /dev/null; }
owner_of() { bus GetNameOwner "$1" | sed -n "s/^('\(.*\)',)\$/\1/p"; }
pid_of() { bus GetConnectionUnixProcessID "$1" | sed -n 's/^(uint32 \([0-9]*\),)$/\1/p'; }
kwallet() { dbus-send --session --print-reply --reply-timeout=20000 --dest=org.kde.ksecretd /ksecretd "org.kde.KWallet.$1" "${@:2}" 2>&1; }
reply() { sed -n -E 's/^ +(string "(.*)"|(int32|boolean) (.*))$/\2\4/p' | head -n 1; }
strings_in() { sed -n -E 's/^ +string "(.*)"$/\1/p' | tr '\n' ',' | sed 's/,$//'; }
alive() { [ -n "$1" ] && ps -o stat= -p "$1" 2> /dev/null | grep -q '^[^Z]'; }
stop() { alive "$1" || return 0; kill -TERM "$1"; for _ in $(seq 1 50); do alive "$1" || return 0; sleep 0.1; done; }

daemon=$(command -v ksecretd || ls /usr/libexec/ksecretd /usr/lib/*/libexec/ksecretd 2> /dev/null | head -n 1)
[ -n "$daemon" ] || { bad "no ksecretd (KWallet 6's wallet daemon) on this system"; exit 1; }
logs=$(mktemp -d)
store_home=$(mktemp -d)
wallets="$HOME/.local/share/kwalletd"
app=kiwi-store-check

login() {
  python3 "$here/distro-check/kwallet-login.py" "$daemon" "$logs/wallet-$1.log" "$logs/wallet-$1.pid"
  local pid
  pid=$(cat "$logs/wallet-$1.pid")
  for _ in $(seq 1 100); do
    [ "$(pid_of "$(owner_of org.freedesktop.secrets)")" = "$pid" ] && grep -q "opened by PAM" "$logs/wallet-$1.log" && break
    alive "$pid" || break
    sleep 0.1
  done
  echo "$pid"
}

secrets_owner() {
  local unique pid
  unique=$(owner_of org.freedesktop.secrets)
  pid=$(pid_of "$unique")
  echo "${unique:-nobody} pid ${pid:-none} $( [ -n "$pid" ] && readlink "/proc/$pid/exe")"
}

first=$(login first)
owner=$(secrets_owner)
if [ "$(echo "$owner" | awk '{ print $3 }')" = "$first" ]; then
  ok "org.freedesktop.secrets belongs to the ksecretd a kwallet-pam login started: $owner"
else
  bad "org.freedesktop.secrets isn't the ksecretd a login started (pid $first): $owner; it said: $(tail -n 5 "$logs/wallet-first.log" | tr '\n' ' ' | cut -c1-400)"
fi
opened=$(grep -m1 -E "opened by PAM" "$logs/wallet-first.log")
if [ -n "$opened" ]; then ok "it made the wallet kdewallet and opened it with the login password's hash, with no prompt: $opened"; else bad "the wallet wasn't opened at login: $(grep -m1 PAM "$logs/wallet-first.log")"; fi

(cd "$repo" && bun desktop/scripts/linux-store-check.ts keyring "$store_home") || failed=1

handle=$(kwallet open string:kdewallet int64:0 "string:$app" | reply)
if [ -n "$handle" ] && [ "$handle" -ge 0 ] 2> /dev/null; then
  info "KWallet's own interface (org.kde.ksecretd /ksecretd org.kde.KWallet) opened kdewallet: handle $handle, folders $(kwallet folderList "int32:$handle" "string:$app" | strings_in)"
  entries=$(kwallet entryList "int32:$handle" string:Channels "string:$app" | strings_in)
  case ",$entries," in
    *,store-key,*store-key-ready,* | *,store-key-ready,*store-key,*) ok "the wallet kdewallet holds the folder Channels with the entries $entries" ;;
    *) bad "the wallet kdewallet's folder Channels holds '$entries', not store-key and store-key-ready" ;;
  esac
  in_wallet=$(kwallet readPassword "int32:$handle" string:Channels string:store-key "string:$app" | reply)
  served=$(timeout 20 secret-tool lookup service Channels account store-key)
  if [ -n "$in_wallet" ] && [ "$in_wallet" = "$served" ]; then
    ok "the wallet's Channels/store-key is the store key the Secret Service gives the app ($(printf %s "$in_wallet" | sha256sum | cut -c1-12) both)"
  else
    bad "the wallet's Channels/store-key ($(printf %s "$in_wallet" | sha256sum | cut -c1-12)) isn't the key the Secret Service gives ($(printf %s "$served" | sha256sum | cut -c1-12))"
  fi
  kwallet close "int32:$handle" boolean:false "string:$app" > /dev/null
else
  bad "KWallet's own interface didn't open kdewallet: $(kwallet open string:kdewallet int64:0 "string:$app" | tail -n 2 | tr '\n' ' ')"
  in_wallet=""
fi

closed=$(kwallet close string:kdewallet boolean:true | reply)
compat=$(pid_of "$(owner_of org.kde.kwalletd6)")
stop "$compat"
stop "$first"
if [ "$closed" = 0 ] && ! alive "$first"; then ok "kdewallet closed and saved, ksecretd stopped$([ -n "$compat" ] && echo ", and the kwalletd6 compatibility service the app's Electron key lookup started")"; else bad "the wallet didn't close (close said '$closed') or ksecretd $first didn't stop"; fi
size=$(stat -c %s "$wallets/kdewallet.kwl" 2> /dev/null)
if [ -n "$size" ] && [ -n "$in_wallet" ] && ! grep -qF "$in_wallet" "$wallets/kdewallet.kwl"; then
  ok "the wallet file kdewallet.kwl ($size bytes) keeps the store key, encrypted: it isn't in the file in the clear"
else
  bad "no wallet file at $wallets/kdewallet.kwl, or the store key is in it in the clear"
fi
gone=$(owner_of org.freedesktop.secrets)
if [ -z "$gone" ]; then ok "with ksecretd stopped, nothing answers for org.freedesktop.secrets"; else bad "something else answers for org.freedesktop.secrets: $(secrets_owner)"; fi

second=$(login second)
owner=$(secrets_owner)
if [ -n "$size" ] && [ "$(echo "$owner" | awk '{ print $3 }')" = "$second" ] && [ "$second" != "$first" ] && grep -q "opened by PAM" "$logs/wallet-second.log"; then
  ok "a second login's ksecretd opened the saved kdewallet with the same password: $owner"
else
  bad "a second login didn't open kdewallet: $owner; it said: $(grep -m2 -E 'PAM|rror' "$logs/wallet-second.log" | tr '\n' ' ' | cut -c1-300)"
fi

(cd "$repo" && bun desktop/scripts/linux-store-check.ts reopen "$store_home") || failed=1

after=$(secrets_owner)
if [ "$(echo "$after" | awk '{ print $3 }')" = "$second" ]; then ok "and the same ksecretd answered for org.freedesktop.secrets throughout: $after"; else bad "org.freedesktop.secrets changed hands during the check: $after"; fi
if pgrep -x gnome-keyring-d > /dev/null; then info "a gnome-keyring-daemon runs on this computer (another step's), but not for this session bus"; fi

stop "$(pid_of "$(owner_of org.kde.kwalletd6)")"
stop "$second"
if [ "$failed" != 0 ]; then
  for log in "$logs"/wallet-*.log; do
    echo "--- $(basename "$log")"
    tail -n 20 "$log"
  done
fi
rm -rf "$logs" "$store_home"
if [ "$failed" = 0 ]; then echo "linux-kwallet-check: the store is sealed under a key KDE's wallet keeps, and opens again after the wallet restarts"; fi
exit "$failed"
