#!/bin/sh
# Install kiwi from this checkout to ~/.kiwi/bin (PREFIX to override).
# Needs bun on PATH: https://bun.sh
# The download installer that people curl lives in site/install.sh.
set -eu
cd "$(dirname "$0")/.."
PREFIX="${PREFIX:-$HOME/.kiwi}"
bun run build
mkdir -p "$PREFIX/bin"
install -m755 dist/kiwi "$PREFIX/bin/kiwi"
echo "installed to $PREFIX/bin/kiwi — make sure it is on your PATH:"
echo "  export PATH=\"$PREFIX/bin:\$PATH\""
echo "then run:  kiwi --help"
