#!/usr/bin/env bash
# Prints the CI jobs a dispatch with no `jobs` input should run: .github/coverage.yml areas
# over the branch's changed files versus main. A job is skipped only when every area the
# diff touches may skip it; any unclaimed file, an empty diff or an unresolvable merge-base
# runs every job, and a release input or a stamp commit titled "kiwi YYYY.M.PATCH" runs
# every job too.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - "${1:-}" <<'PY'
import subprocess, sys, re, yaml

ALL = ["static", "test-unit", "test-flows", "build", "doc", "fuzz", "shots", "desktop-mac", "desktop-linux", "desktop-distros", "cli-macos"]

def every():
    print(" ".join(j for j in ALL if j != "desktop-distros"))
    sys.exit(0)

if sys.argv[1]:
    every()
subject = subprocess.run(["git", "log", "-1", "--format=%s", "HEAD"], capture_output=True, text=True).stdout.strip()
if re.match(r"^kiwi \d{4}\.\d{1,2}\.\d+(-rc\.\d+)?$", subject):
    every()

try:
    base = subprocess.run(["git", "merge-base", "HEAD", "origin/main"], capture_output=True, text=True, check=True).stdout.strip()
    files = subprocess.run(["git", "diff", "--name-only", base, "HEAD"], capture_output=True, text=True, check=True).stdout.splitlines()
except subprocess.CalledProcessError:
    every()
if not base or not files:
    every()

areas = yaml.safe_load(open(".github/coverage.yml"))["areas"]
touched = set()
for f in files:
    claimed = False
    for name, a in areas.items():
        if any(f.startswith(p) for p in a["paths"]):
            touched.add(name)
            claimed = True
    if not claimed:
        every()

skip = set(areas[touched.pop()]["skip"]) if touched else set()
for name in touched:
    skip &= set(areas[name]["skip"])
skip.add("desktop-distros")

print(" ".join(j for j in ALL if j not in skip))
PY
