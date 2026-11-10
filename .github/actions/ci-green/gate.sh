#!/usr/bin/env bash
# The release gate: refuses (exit 1) unless the ci push run on main at $1 is green
# in every expected leg, latest attempt only. $2 names the ref for messages.
set -uo pipefail
SHA="${1:?sha}"
REF="${2:?ref}"
REPO="${GITHUB_REPOSITORY:?}"
die() { echo "::error::$*"; echo "Recovery: re-run the push run in full (gh run rerun <run id>, never --failed) so the newest attempt holds every leg, then re-run this ci-green job. A commit with no push run on main stays blocked; the only way to get one is a push to main at that SHA."; exit 1; }
deadline=$(( $(date +%s) + 45*60 ))
run_id=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  run_id=$(gh api "repos/$REPO/actions/runs?event=push&branch=main&per_page=30" --jq ".workflow_runs[] | select(.head_sha == \"$SHA\" and .name == \"ci\") | .id" | head -1 || true)
  [ -n "$run_id" ] && break
  sleep 60
done
[ -n "$run_id" ] || die "no ci push run on main at $REF's commit $SHA appeared within 45 minutes"
while [ "$(gh api "repos/$REPO/actions/runs/$run_id" --jq .status)" != "completed" ]; do
  [ "$(date +%s)" -lt "$deadline" ] || die "push run $run_id did not finish within the gate's bound"
  sleep 60
done
url="https://github.com/$REPO/actions/runs/$run_id"
aid=$(gh api "repos/$REPO/actions/runs/$run_id/artifacts?per_page=100" --jq '.artifacts[] | select(.name == "ci-legs") | .id' | head -1)
[ -n "$aid" ] || die "push run $run_id uploaded no ci-legs manifest"
curl -fsSL -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/actions/artifacts/$aid/zip" -o legs.zip || die "could not download the ci-legs manifest"
unzip -o -q legs.zip
legs=$(jq -c '. + (["desktop / distros, arch", "ci-ok"] - .)' ci-legs.json 2>/dev/null) || die "the ci-legs manifest is not valid JSON"
attempt=$(gh api "repos/$REPO/actions/runs/$run_id" --jq .run_attempt)
jobs_json=$(gh api "repos/$REPO/actions/runs/$run_id/attempts/$attempt/jobs?per_page=100" --jq '[.jobs[] | {name, conclusion}]') || die "could not read the jobs of attempt $attempt"
bad=$(jq -rn --argjson legs "$legs" --argjson jobs "$jobs_json" --arg attempt "$attempt" '
  ($jobs | map(.name)) as $names |
  ($legs[] | select(. as $l | $names | index($l) | not) | "\(.) missing from attempt \($attempt)"),
  ($jobs[] | select(.name as $n | ($legs | index($n))) | select(.conclusion != "success") | "\(.name): \(.conclusion)")')
if [ -n "$(printf '%s' "$bad" | tr -d '[:space:]')" ]; then
  printf 'refusing: not every expected leg is green in attempt %s of %s\n%s\n' "$attempt" "$url" "$bad"
  die "the release gate refuses to build or publish $REF"
fi
printf 'every expected leg green in attempt %s of %s\n' "$attempt" "$url"
