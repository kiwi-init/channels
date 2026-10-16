# bus

The merge bus is the one writer to main. Agents push `bus/<task>` and go back to work; the bus
merges each branch onto main, resolves what it can, tests the exact merged tree on `bus/staging`
and fast-forwards main. Everything it decides becomes a `bus.*` event in the team's Kiwi channel.

Each run of [`bus.yml`](../workflows/bus.yml) is one stateless tick (bors): it reads the state
from GitHub and does the next step.

1. **tick** (read-only): if `bus/staging` sits on main and its item is unchanged, wait for its
   CI, then land it or diagnose it. Otherwise take the oldest `bus/*` branch (or a PR a
   maintainer labelled `queue`, never a fork), ahead of it any branch Jev's `needs_order` says
   it needs first, and merge it onto main: git, then mergiraf on `*.ts`/`*.tsx`, then
   keep-both for hunks whose base was empty when Jev's `keep_both` is high.
2. **resolve** (read-only, model keys only): Haiku resolves each hunk left, sampled 3 times,
   and may abstain. A hunk Haiku abstains on or disagrees with itself on, that Jev's
   `intent_shift` rates high, or whose merged tree fails a check, goes back to its author.
   Opus is configured but off: add `opus` to `ladder` to let it take those hunks first. It
   writes `resolution.patch`, which may only replace whole conflicts, or a bounce with
   Haiku's note for the author.
3. **stage** (App token, no model): redoes the merge, checks the patch fits only the
   conflicts, runs [`validate.ts`](validate.ts) (no markers, parses, no duplicate class
   members, `tsc` on the touched projects), commits the merge with an `Agent:` trailer and
   pushes `bus/staging`. `ci.yml` runs on it, and jev-ci plans from the item's fork point,
   so the jobs either side can break run.
4. **land** (App token): ci-ok green fast-forwards main and emits `bus.landed`. Red runs
   **doctor** (read-only): Jev's `unrelated_failure` reruns a flake once, otherwise Haiku
   writes the cause in one line, and **settle** bounces the item (`bus/T7` moves to
   `bounced/T7`; a PR loses its label and gets a comment).
5. **last-green**: the full CI run on main moves `last-green` forward when ci-ok passes.

Thresholds, the ladder and the typechecks are in the `bus:` block of
[`.github/jev-ci.yml`](../jev-ci.yml). Jev only sets numbers there; no model approves a merge.

Replay the ladder on open pull requests (needs `TYPESAFE_API_KEY` and `ANTHROPIC_API_KEY`
for the model tiers; `--no-models` stops after keep-both):

    bun .github/bus/ladder.ts 226 228 229
