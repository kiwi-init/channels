#!/usr/bin/env bash
set -u
D=$1
APP=$2
OUT=$3
INPUT=${4:-}
HERE=$(cd "$(dirname "$0")" && pwd)
unset DISPLAY XAUTHORITY GDK_BACKEND
echo "session $D: WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-} DISPLAY=${DISPLAY:-} XDG_CURRENT_DESKTOP=${XDG_CURRENT_DESKTOP:-}" | tee -a "$OUT/$D-notes.txt"
pgrep -a -x Xwayland | sed 's/^/Xwayland before: /' | tee -a "$OUT/$D-notes.txt"
KIWI_AUDIT_VARIANT=sandboxed bun "$HERE/audit.ts" "$APP" "$OUT" "$D" "$INPUT" 2>&1 | tee "$OUT/$D-sandboxed-audit.log"
KIWI_AUDIT_VARIANT=unsandboxed KIWI_AUDIT_NO_SANDBOX=1 bun "$HERE/audit.ts" "$APP" "$OUT" "$D" "$INPUT" 2>&1 | tee "$OUT/$D-unsandboxed-audit.log"
pgrep -a -x Xwayland | sed 's/^/Xwayland after: /' | tee -a "$OUT/$D-notes.txt"
pgrep -x Xwayland > /dev/null || echo "no Xwayland ran" | tee -a "$OUT/$D-notes.txt"
