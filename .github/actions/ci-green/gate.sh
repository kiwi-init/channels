#!/usr/bin/env bash
set -uo pipefail
SHA="${1:?sha}"
REF="${2:?ref}"
REPO="${GITHUB_REPOSITORY:?}"
FULL_LEGS='["repo / static","test / unit","test / flows","build / bundles, app","build / bundles, ui-a","build / bundles, ui-b","build / doc, send","build / doc, edit","build / doc, view","build / fuzz","build / shots, chromium","build / shots, webkit","desktop / mac","desktop / linux, ubuntu-24.04","desktop / linux, ubuntu-26.04","desktop / distros, arch","cli / macos","ci-ok"]'
die() { echo "::error::$*"; echo "Recovery: re-run the push run in full (gh run rerun <run id>, never --failed) so the newest attempt holds every leg, then re-run this ci-green job. A commit with no push run on main stays blocked; the only way to get one is a push to main at that SHA."; exit 1; }
deadline=$(( $(date +%s) + 45*60 ))
run_id=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  page=1
  while [ "$page" -le 5 ]; do
    runs_json=$(gh api "repos/$REPO/actions/workflows/ci.yml/runs?event=push&branch=main&head_sha=$SHA&per_page=50&page=$page") || die "could not list ci push runs (page $page)"
    run_id=$(printf '%s' "$runs_json" | jq -r --arg sha "$SHA" '[.workflow_runs[]? | select(.head_sha == $sha)][0].id // empty' 2>/dev/null) || die "could not parse the ci push run list (page $page)"
    [ -n "$run_id" ] && break 2
    count=$(printf '%s' "$runs_json" | jq '.workflow_runs | length' 2>/dev/null) || die "could not count the ci push run list (page $page)"
    [ "$count" -lt 50 ] && break
    page=$((page + 1))
  done
  sleep 60
done
[ -n "$run_id" ] || die "no ci push run on main at $REF's commit $SHA appeared within 45 minutes"
while :; do
  status=$(gh api "repos/$REPO/actions/runs/$run_id" --jq .status) || die "could not read push run $run_id's status"
  [ "$status" = "completed" ] && break
  [ "$(date +%s)" -lt "$deadline" ] || die "push run $run_id did not finish within the gate's bound"
  sleep 60
done
url="https://github.com/$REPO/actions/runs/$run_id"
aid=$(gh api "repos/$REPO/actions/runs/$run_id/artifacts?per_page=100" --jq '.artifacts[] | select(.name == "ci-legs") | .id' | head -1) || die "could not list the run's artifacts"
[ -n "$aid" ] || die "push run $run_id uploaded no ci-legs manifest"
curl -fsSL -H "Authorization: Bearer ${GH_TOKEN:?}" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/actions/artifacts/$aid/zip" -o legs.zip || die "could not download the ci-legs manifest"
unzip -o -q legs.zip || die "could not unpack the ci-legs manifest"
legs=$(jq -c '. + (["desktop / distros, arch", "ci-ok"] - .) // empty' ci-legs.json) || die "the ci-legs manifest is not valid JSON"
[ -n "$legs" ] || die "the ci-legs manifest is not a JSON array"
jq -e 'type == "array" and length > 0 and all(.[]; type == "string" and length > 0) and (length == (unique | length))' <<< "$legs" > /dev/null || die "the ci-legs manifest is empty or malformed"
missing=$(jq -rn --argjson full "$FULL_LEGS" --argjson legs "$legs" '$full - $legs | join(", ")')
[ -z "$missing" ] || die "the ci-legs manifest is incomplete: $missing"
attempt=$(gh api "repos/$REPO/actions/runs/$run_id" --jq .run_attempt) || die "could not read the run's attempt count"
rm -f gate-jobs.all
page=1
while :; do
  page_json=$(gh api "repos/$REPO/actions/runs/$run_id/attempts/$attempt/jobs?per_page=100&page=$page") || die "could not read the jobs of attempt $attempt (page $page)"
  printf '%s\n' "$page_json" | jq -e 'type == "object" and (.jobs | type == "array")' > /dev/null 2>&1 || die "could not parse the jobs of attempt $attempt (page $page)"
  printf '%s' "$page_json" | jq -c '[.jobs[]? | {name, conclusion}]' >> gate-jobs.all
  count=$(printf '%s' "$page_json" | jq '.jobs | length')
  [ "$count" -lt 100 ] && break
  page=$((page + 1))
done
jobs_json=$(jq -s 'add' gate-jobs.all) || die "could not assemble the jobs of attempt $attempt"
bad=$(jq -rn --argjson legs "$legs" --argjson jobs "$jobs_json" --arg attempt "$attempt" '
  ($jobs | map(.name)) as $names |
  ($legs[] | select(. as $l | $names | index($l) | not) | "\(.) missing from attempt \($attempt)"),
  ($jobs[] | select(.name as $n | ($legs | index($n))) | select(.conclusion != "success") | "\(.name): \(.conclusion)")') || die "the leg evaluation failed"
if [ -n "$(printf '%s' "$bad" | tr -d '[:space:]')" ]; then
  printf 'refusing: not every expected leg is green in attempt %s of %s\n%s\n' "$attempt" "$url" "$bad"
  die "the release gate refuses to build or publish $REF"
fi
printf 'every expected leg green in attempt %s of %s\n' "$attempt" "$url"
