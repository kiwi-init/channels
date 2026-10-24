#!/usr/bin/env bash
set -u
dir=$1
t=$2
work=$(mktemp -d)
raw="$dir/kiwi-$t"
[ -f "$raw" ] && [ -f "$raw.gz" ] && [ -f "$raw.xz" ] || { echo "kiwi-$t: missing one of the raw, .gz and .xz downloads"; ls -la "$dir"; exit 1; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
size() { wc -c < "$1" | tr -d ' '; }
want=$(sha "$raw")
gunzip -c "$raw.gz" > "$work/from-gz"
xz -dc "$raw.xz" > "$work/from-xz"
for f in from-gz from-xz; do
  got=$(sha "$work/$f")
  [ "$got" = "$want" ] || { echo "kiwi-$t: the $f download unpacks to $got, not the raw binary's $want"; exit 1; }
done
echo "kiwi-$t: raw $(size "$raw") bytes, .gz $(size "$raw.gz"), .xz $(size "$raw.xz"), both unpack to the raw binary ($want)"
bad=0
for f in from-gz from-xz; do
  chmod +x "$work/$f"
  home=$(mktemp -d)
  v=$(env HOME="$home" KIWI_HOME="$home/.kiwi" KIWI_NO_HOOKS=1 "$work/$f" --version 2>&1)
  env HOME="$home" KIWI_HOME="$home/.kiwi" KIWI_NO_HOOKS=1 perl -e 'alarm shift; exec @ARGV' 180 "$work/$f" demo -n 0 > "$work/$f.log" 2>&1
  code=$?
  top=$(grep -oE '^#[0-9]+' "$work/$f.log" | tr -d '#' | sort -n | tail -n 1)
  errs=$(grep -ciE 'refused|error|failed|couldn.t' "$work/$f.log")
  if [ "$code" -eq 0 ] && [ "${top:-0}" -ge 20 ] && [ "$errs" -eq 0 ] && grep -q 'That was a real channel and the real client' "$work/$f.log"; then
    echo "kiwi-$t ($f, $v): kiwi demo made a channel on its own relay and read back #1 to #$top, exit 0"
  else
    echo "kiwi-$t ($f, $v): kiwi demo exited $code, read back up to #${top:-none}, $errs error lines:"
    tail -n 40 "$work/$f.log"
    bad=1
  fi
done
exit $bad
