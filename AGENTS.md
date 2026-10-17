# AGENTS.md

## Code

- Comments in code are forbidden, including tool directives (`@ts-expect-error`, `@ts-ignore`, `oxlint-disable`, `eslint-disable`, `type: ignore`, `noqa`, `pragma` etc.). Only exception: a Python docstring strictly required at runtime, listed in `ALLOWED_DOCSTRINGS` in `scripts/ci/no_comments.py` (empty today) and justified in the PR; anything else fails the `repo / comments` guard. Context goes in the commit and the PR.
- Everything strictly typed. No `any`, no implicit `any`, no untyped code, in TypeScript and in Python. In Python, every function has parameter and return types, with no `Any`.
- Front end: lint with oxlint and format with oxfmt (no Biome, no Prettier).
- UI work follows `DESIGN.md` (theme, colors, radius, typography, motion).

## Branches and CI

- One issue = one branch. Agents finish a task with `git push origin HEAD:bus/<task>` (for example `bus/T52-compress`). Never open a PR, rebase or merge: the merge bus (`.github/bus`) merges the branch onto main and lands it. Listen for `bus.*` events on your task; `bus.bounced` hands the task back with what it collides with, and you push to `bus/<task>` again. When no `bus.*` events arrive, check origin for `bounced/<task>`: that branch means the bus handed it back.
- What the bus waits for: `ci.yml` runs on every pushed `bus/<task>` branch by itself, in parallel with other branches, and plans only the jobs your change can break. When that run is green and the branch merges cleanly (main changed none of the same files since you branched, and neither side touches `.github/`, a `package.json` or a lockfile), the bus lands it right away, in about a minute, without a second test. The same goes for a PR a maintainer labelled `queue`, using the PR's own CI run. Anything else (a conflict, a shared file, CI or dependency files, a red or missing run on the branch) goes through `bus/staging` as before: the merged tree is tested again, about 8 minutes, and the result is `bus.landed` or `bus.bounced`. So keep a branch small, branch from a recent main, and watch the CI run on your own branch: a red run there is yours to fix before the bus takes it.
- Work outside the bus (people, outside contributors) is one branch = one PR, and joins the bus when a maintainer labels it `queue`.
- A conflicted lockfile is never resolved by hand: take the remote one and regenerate it.
- Small commits. Before every push, run the checks for the area you touched, then push: `git push origin HEAD:bus/<task>` for an agent task, a plain `git push` on a PR branch.
- Forbidden: manual force-push, `--no-verify`, `[skip ci]`, and merging with the `ci-ok` check red.
- Long-running processes (CI, checks, tests, builds, servers, waiting on a CI run) run detached, in background, so a turn interruption does not kill them: start them with the agent tool's background mode or, in the shell, with `nohup <command> > file.log 2>&1 &` (or `setsid`), never with a bare `&`, which does not detach the process from the shell; send output to a log file and follow the log or the completion notice instead of blocking the turn waiting.
- Every change ships with its CI gate: its own job in `ci.yml`, named `<area> / <check>` (e.g. `web / lint`) and listed in the `needs` of `ci-ok`.

## Authorship

- Only agents commit; there are no human commits. Every agent acts on behalf of a person and signs as `{model_slug} on behalf of {human_name}`:
  - commits: an `Agent: {model_slug} on behalf of {human_name}` trailer is required on every commit (CI rejects commits without it);
  - PR comments: the first line of every comment, review, inline review comment and thread reply, and also of the PR description.
