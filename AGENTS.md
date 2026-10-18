# AGENTS.md

## Our Philosophy 

- Optimism beats everything.
- We must refuse to confuse working/done with good.
- Ambition, creativity, boldness. 

and the most important of them all: we can fix everything! 
## Code

- No comments in code: context goes in the commit and the PR. One exception: a comment inside a `catch` block, saying why the error is ignored or handled that way. Tool directives (`@ts-expect-error`, `@ts-ignore`, `oxlint-disable`, `eslint-disable`, `type: ignore`, `noqa`, `pragma` etc.) stay forbidden. CI does not check this; review does.
- Everything strictly typed. No `any`, no implicit `any`, no untyped code, in TypeScript and in Python. In Python, every function has parameter and return types, with no `Any`.
- Front end: lint with oxlint and format with oxfmt (no Biome, no Prettier).
- UI work follows `DESIGN.md` (theme, colors, radius, typography, motion).

## Branches and CI

- One issue = one branch = one pull request. Name the branch after the task (for example `T52-compress`), push it, and open a PR into `main`. Keep it small and branch from a recent `main`. The PR's CI runs by itself and `ci-ok` is the gate: when it is green, squash-merge the PR (`gh pr merge --squash`). If `main` moved and the PR conflicts, merge `main` into the branch and fix the conflicts there; never rebase or force-push.
- People and outside contributors work the same way: one branch = one PR.
- A conflicted lockfile is never resolved by hand: take the remote one and regenerate it.
- Small commits. Before every push, run the checks for the area you touched, then a plain `git push`.
- Forbidden: manual force-push, `--no-verify`, `[skip ci]`, and merging with the `ci-ok` check red.
- Long-running processes (CI, checks, tests, builds, servers, waiting on a CI run) run detached, in background, so a turn interruption does not kill them: start them with the agent tool's background mode or, in the shell, with `nohup <command> > file.log 2>&1 &` (or `setsid`), never with a bare `&`, which does not detach the process from the shell; send output to a log file and follow the log or the completion notice instead of blocking the turn waiting.
- Every change ships with its CI gate, as a step in the job for its area in `ci.yml` (`repo / static`, `test / unit`, `test / flows-a`, `test / flows-b`, `build / bundles`, `desktop / package`, `cli / macos`), and with that job's `inputs` and `description` in `.github/jev-ci.yml` updated to cover it. A new test file lands in `test / unit` unless `scripts/ci-tests.ts` puts it in a flows group. Add a job only when the check needs its own runner (another OS, a long build) or would become the slowest step in its job by a wide margin; then name it `<area> / <check>`, give it a `timeout-minutes`, add it to `.github/jev-ci.yml` and to the `needs` of `ci-ok`. The only required check is `ci-ok`.

## Authorship

- Only agents commit; there are no human commits. Every agent acts on behalf of a person and signs as `{model_slug} on behalf of {human_name}`:
  - commits: an `Agent: {model_slug} on behalf of {human_name}` trailer is required on every commit (CI rejects commits without it);
  - PR comments: the first line of every comment, review, inline review comment and thread reply, and also of the PR description.
