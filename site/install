#!/bin/sh
# Installs kiwi, the Kiwi Init command line, for macOS and Linux.
#
# What it does, in order:
#   1. picks the build for this computer (macOS or Linux, Intel or ARM)
#   2. downloads it from this project's GitHub release, built from the public source,
#      compressed (.xz when xz is installed, else .gz) when the release has it
#   3. checks the download's SHA-256 against the release's SHA256SUMS before installing
#   4. puts it at ~/.kiwi/bin/kiwi (nothing outside your home folder, no sudo)
#   5. adds that folder to PATH in your shell's profile, once (KIWI_NO_MODIFY_PATH=1 skips it)
# SHA256SUMS comes from the same release as the binary. It catches a bad
# download, not a release that was swapped. The `gh attestation verify`
# line at the end is printed for you to run; this script does not run it.
# Read the source: https://github.com/kiwi-init/channels
#
# With `sh -s -- join CODE [...]` it then runs `kiwi join CODE [...]`, so one
# pasted line installs kiwi and asks to join a channel. With
# `sh -s -- login` it runs `kiwi login`, which adds this computer to the
# devices of the person who signs in. Nothing else is run.
set -eu

case "${1:-}" in
  ""|join|login) ;;
  *)
    echo "kiwi: the installer only runs \`kiwi join\` or \`kiwi login\` after installing (got: $1)" >&2
    exit 1
    ;;
esac

REPO="kiwi-init/channels"
VERSION="${KIWI_VERSION:-latest}"
DIR="${KIWI_INSTALL:-$HOME/.kiwi/bin}"

os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) echo "kiwi: $os isn't supported: kiwi runs on macOS and Linux" >&2; exit 1 ;;
esac
case "$arch" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64)
    arch=x64
    if [ "$os" = darwin ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = 1 ]; then arch=arm64; fi
    ;;
  *) echo "kiwi: no build for $arch" >&2; exit 1 ;;
esac
asset="kiwi-$os-$arch"
if [ "$VERSION" = latest ]; then base="https://github.com/$REPO/releases/latest/download"; else base="https://github.com/$REPO/releases/download/$VERSION"; fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS"
listed() { grep -q " $1\$" "$tmp/SHA256SUMS"; }
name="$asset"
if command -v xz >/dev/null 2>&1 && listed "$asset.xz"; then
  name="$asset.xz"
elif command -v gzip >/dev/null 2>&1 && listed "$asset.gz"; then
  name="$asset.gz"
fi
echo "Downloading $name ($VERSION) from github.com/$REPO"
curl -fsSL "$base/$name" -o "$tmp/$name"

want=$(grep " $name\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)
if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$tmp/$name" | cut -d' ' -f1); else got=$(shasum -a 256 "$tmp/$name" | cut -d' ' -f1); fi
if [ -z "$want" ] || [ "$want" != "$got" ]; then
  echo "kiwi: checksum doesn't match the release; not installing" >&2
  exit 1
fi
case "$name" in
  *.xz) xz -dc "$tmp/$name" > "$tmp/kiwi" ;;
  *.gz) gzip -dc "$tmp/$name" > "$tmp/kiwi" ;;
  *) mv "$tmp/$name" "$tmp/kiwi" ;;
esac

# ~/.kiwi is private to this account. bin stays 0755 inside that parent.
# A symlink is left alone: chmod would follow it.
if [ -z "${KIWI_INSTALL:-}" ]; then
  if [ ! -e "$HOME/.kiwi" ]; then
    mkdir -m 700 "$HOME/.kiwi"
  elif [ -d "$HOME/.kiwi" ] && [ ! -L "$HOME/.kiwi" ]; then
    chmod 700 "$HOME/.kiwi"
  fi
fi
mkdir -p "$DIR"
mv "$tmp/kiwi" "$DIR/kiwi"
chmod 755 "$DIR/kiwi"
echo "Installed kiwi $("$DIR/kiwi" --version) at $DIR/kiwi (checksum verified)"
"$DIR/kiwi" cleanup --quiet </dev/null || true
# New terminals find plain `kiwi`: unless this shell's profile already names $DIR, one marked
# line goes at its end, once (the same line the desktop app and `kiwi setup` add). The shell is
# $SHELL's: zsh, bash or fish; anything else gets ~/.profile. KIWI_NO_MODIFY_PATH=1 leaves every
# profile alone and prints the line instead.
case ":$PATH:" in
  *":$DIR:"*) ;;
  *)
    rest=${DIR#"$HOME"}
    if [ "$rest" != "$DIR" ]; then shown="\$HOME$rest"; else shown="$DIR"; fi
    line="export PATH=\"$shown:\$PATH\""
    case "$(basename "${SHELL:-sh}")" in
      zsh) rc="${ZDOTDIR:-$HOME}/.zshrc" ;;
      bash) if [ "$os" = darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
      fish) rc="$HOME/.config/fish/conf.d/kiwi.fish"; line="fish_add_path -g \"$shown\"" ;;
      *) rc="$HOME/.profile" ;;
    esac
    if [ -f "$rc" ] && { grep -qF -e "$DIR" "$rc" || { [ "$rest" != "$DIR" ] && grep -qF -e "\$HOME$rest" -e "\${HOME}$rest" -e "~$rest" "$rc"; }; }; then
      echo "$rc already puts $DIR on your PATH: open a new terminal to type plain kiwi."
    elif [ -n "${KIWI_NO_MODIFY_PATH:-}" ]; then
      echo "To type plain kiwi, add this to $rc: $line"
    elif {
      mkdir -p "$(dirname "$rc")" &&
        { [ ! -s "$rc" ] || [ -z "$(tail -c 1 "$rc")" ] || echo >>"$rc"; } &&
        printf '\n%s\n%s\n' "# Added by the kiwi installer: puts the kiwi CLI on your PATH." "$line" >>"$rc"
    } 2>/dev/null; then
      echo "Added $DIR to your PATH in $rc: open a new terminal to type plain kiwi."
    else
      echo "Couldn't write $rc. To type plain kiwi, add this to your shell profile: $line"
    fi
    ;;
esac
echo "Check where it came from: gh attestation verify $DIR/kiwi --repo $REPO --signer-workflow $REPO/.github/workflows/release.yml"

if [ "$#" -gt 0 ]; then
  echo
  # stdin is this script's pipe: kiwi gets none.
  "$DIR/kiwi" "$@" </dev/null
fi
