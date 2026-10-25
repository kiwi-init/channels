#!/usr/bin/env bash
set -u
TO=$1
OUT=$2
KEY=$3
mkdir -p "$OUT"
problems=()
cd "$OUT" || exit 1
gh release download "v$TO" -R "$GITHUB_REPOSITORY" -D . || exit 1
ls -la
sha256sum -c SHA256SUMS || problems+=("sha256sum -c SHA256SUMS fails")
listed=$(awk '{ print $2 }' SHA256SUMS | sort)
present=$(ls | grep -v -x -e SHA256SUMS -e SHA256SUMS.minisig | sort)
[ "$listed" = "$present" ] || problems+=("SHA256SUMS and the release's files differ: $(diff <(echo "$listed") <(echo "$present") | tr '\n' ' ')")
minisign -Vm SHA256SUMS -P "$KEY" || problems+=("SHA256SUMS.minisig doesn't verify with the release key")
for f in $present; do
  gh attestation verify "$f" -R "$GITHUB_REPOSITORY" > /dev/null 2>&1 && echo "attested: $f" || problems+=("no build-provenance attestation verifies $f")
done
ls | grep -q -- '-mac-x64' && problems+=("the release still ships an Intel Mac app")

page=$(curl -fsSL https://channels.kiwiinit.com/app.js) || problems+=("the site's app.js didn't load")
names=$(echo "$page" | grep -oE 'Channels-[0-9]+\.[0-9]+\.[0-9]+-[A-Za-z0-9_.-]+' | sort -u)
echo "the site offers: $(echo "$names" | tr '\n' ' ')"
echo "$names" | grep -qv -- "Channels-$TO-" && problems+=("the site still names another version: $(echo "$names" | grep -v -- "Channels-$TO-" | tr '\n' ' ')")
for n in $names; do
  code=$(curl -sIL -o /dev/null -w '%{http_code}' "https://github.com/$GITHUB_REPOSITORY/releases/latest/download/$n")
  [ "$code" = 200 ] && echo "downloads: $n" || problems+=("$n answers $code from releases/latest/download")
  [ -e "$n" ] || problems+=("the site names $n, which the release doesn't have")
done

export KIWI_HOME="$OUT/kiwi-home"
curl -fsSL https://channels.kiwiinit.com/install | sh > install.log 2>&1 || problems+=("the install script failed: $(tail -n 5 install.log | tr '\n' ' ')")
got=$("$HOME/.kiwi/bin/kiwi" --version 2> /dev/null || "$KIWI_HOME/bin/kiwi" --version 2> /dev/null)
echo "the install script's kiwi: $got"
echo "$got" | grep -q "$TO" || problems+=("the install script installed '$got', not $TO")

if [ ${#problems[@]} -gt 0 ]; then
  printf 'FAIL %s\n' "${problems[@]}"
  exit 1
fi
echo "ok: $TO's files match SHA256SUMS, its signature and attestations verify, and the site and install script hand out $TO"
