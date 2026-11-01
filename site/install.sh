#!/bin/sh
# Installs kiwi, the Kiwi Init command line, for macOS and Linux.
#
# What it does, in order:
#   1. picks the build for this computer (macOS or Linux, Intel or ARM)
#   2. downloads it from this project's GitHub release, built from the public source,
#      compressed (.xz when xz is installed, else .gz) when the release has it
#   3. checks the release's SHA256SUMS against the minisign signature the release
#      also carries, with the public key pinned in this script (minisign when
#      installed, else a self-contained python3 check of the same signature),
#      then the download's SHA-256 against those checksums, before installing
#   4. puts it at ~/.kiwi/bin/kiwi (nothing outside your home folder, no sudo)
#   5. adds that folder to PATH in your shell's profile, once (KIWI_NO_MODIFY_PATH=1 skips it)
# The signature is the real gate: SHA256SUMS travels with the binary, so a
# checksum alone would pass a release swapped for another. Without minisign or
# python3 nothing here can check it, so the install stops; KIWI_UNVERIFIED_INSTALL=1
# goes on anyway, on the checksum alone. The `gh attestation verify` line at
# the end is printed for you to run; this script does not run it.
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
KEY="RWT9dHgjaqvLBIY4G1i7/a8YdkXuiKOLfV/f+hr6I3ZpeYsVBVI3hw++"

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
curl -fsSL "$base/SHA256SUMS.minisig" -o "$tmp/SHA256SUMS.minisig" || { echo "kiwi: the release has no SHA256SUMS.minisig; not installing" >&2; exit 1; }
if command -v minisign >/dev/null 2>&1; then
  minisign -V -q -m "$tmp/SHA256SUMS" -x "$tmp/SHA256SUMS.minisig" -P "$KEY"
elif command -v python3 >/dev/null 2>&1; then
  cat >"$tmp/minisign-verify.py" <<'PYKIWI'
import base64
import hashlib
import sys
from typing import Optional, Tuple

p = 2 ** 255 - 19
L = 2 ** 252 + 27742317777372353535851937790883648493
d = -121665 * pow(121666, p - 2, p) % p
SQRT_M1 = pow(2, (p - 1) // 4, p)
BASE_Y = 4 * pow(5, p - 2, p) % p
Point = Tuple[int, int, int, int]


def xrecover(y: int) -> int:
    xx = (y * y - 1) * pow(d * y * y + 1, p - 2, p) % p
    x = pow(xx, (p + 3) // 8, p)
    if (x * x - xx) % p != 0:
        x = x * SQRT_M1 % p
    if x % 2 != 0:
        x = p - x
    return x


BASE = (xrecover(BASE_Y) % p, BASE_Y, 1, xrecover(BASE_Y) * BASE_Y % p)
IDENTITY: Point = (0, 1, 1, 0)


def add(m: Point, n: Point) -> Point:
    x1, y1, z1, t1 = m
    x2, y2, z2, t2 = n
    a = (y1 - x1) * (y2 - x2) % p
    b = (y1 + x1) * (y2 + x2) % p
    c = 2 * t1 * d * t2 % p
    z = 2 * z1 * z2 % p
    e, f, g, h = b - a, z - c, z + c, b + a
    return (e * f % p, g * h % p, f * g % p, e * h % p)


def multiply(m: Point, e: int) -> Point:
    r = IDENTITY
    while e > 0:
        if e & 1:
            r = add(r, m)
        m = add(m, m)
        e >>= 1
    return r


def encode(m: Point) -> bytes:
    x, y, z, _ = m
    z_inv = pow(z, p - 2, p)
    x = x * z_inv % p
    y = y * z_inv % p
    return (y | (x & 1) << 255).to_bytes(32, "little")


def decode(s: bytes) -> Point:
    y = int.from_bytes(s, "little") & (1 << 255) - 1
    if y >= p:
        raise ValueError
    x = xrecover(y)
    if x == 0 and s[31] >> 7:
        raise ValueError
    if x & 1 != s[31] >> 7:
        x = p - x
    m = (x, y, 1, x * y % p)
    if (y * y - x * x - 1 - d * x * x * y * y) % p:
        raise ValueError
    return m


def ed25519(public: bytes, signature: bytes, message: bytes) -> bool:
    if len(public) != 32 or len(signature) != 64:
        return False
    s = int.from_bytes(signature[32:], "little")
    if s >= L:
        return False
    try:
        a = decode(public)
        r = decode(signature[:32])
    except ValueError:
        return False
    h = int.from_bytes(hashlib.sha512(signature[:32] + public + message).digest(), "little")
    return encode(multiply(BASE, s)) == encode(add(r, multiply(a, h)))


def b64(text: str) -> Optional[bytes]:
    try:
        return base64.b64decode(text, validate=True)
    except Exception:
        return None


def why_not(data: bytes, sig_text: str, key_text: str) -> Optional[str]:
    lines = sig_text.replace("\r", "").split("\n")
    if len(lines) < 4 or not lines[0].startswith("untrusted comment:") or not lines[2].startswith("trusted comment: "):
        return "the signature file isn't a minisign signature"
    key = b64(key_text.strip())
    if not key or len(key) != 42 or key[:2] != b"Ed":
        return "that public key isn't a minisign key"
    sig = b64(lines[1])
    glob = b64(lines[3])
    if not sig or len(sig) != 74 or sig[:2] not in (b"Ed", b"ED") or sig[2:10] != key[2:10]:
        return "the signature names another key"
    if not glob or len(glob) != 64:
        return "the signature's second half is malformed"
    signed = hashlib.blake2b(data, digest_size=64).digest() if sig[:2] == b"ED" else data
    if not ed25519(key[10:], sig[10:], signed):
        return "the signature doesn't verify this release's checksums"
    comment = lines[2][len("trusted comment: "):].encode()
    if not ed25519(key[10:], glob, sig[10:] + comment):
        return "the signature's trusted comment doesn't verify"
    return None


if __name__ == "__main__":
    refusal = why_not(open(sys.argv[1], "rb").read(), open(sys.argv[2], "r").read(), sys.argv[3])
    if refusal:
        print("kiwi: %s" % refusal, file=sys.stderr)
        sys.exit(1)
PYKIWI
  python3 "$tmp/minisign-verify.py" "$tmp/SHA256SUMS" "$tmp/SHA256SUMS.minisig" "$KEY"
else
  echo "kiwi: neither minisign nor python3 is installed here, so the release's signature can't be checked" >&2
  if [ "${KIWI_UNVERIFIED_INSTALL:-}" != "1" ]; then
    echo "kiwi: install minisign or python3 and run this again, or set KIWI_UNVERIFIED_INSTALL=1 to install on the checksum alone" >&2
    exit 1
  fi
  echo "kiwi: KIWI_UNVERIFIED_INSTALL=1: installing on the checksum alone" >&2
fi
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
