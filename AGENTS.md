# AGENTS.md

## Our Philosophy 

- Optimism beats everything.
- We must refuse to confuse working/done with good.
- Ambition, creativity, boldness. 

and the most important of them all: we can fix everything! 

## Code

- No comments in code: context goes in the commit and the PR. One exception: a comment inside a `catch` block, saying why the error is ignored or handled that way. Tool directives (`@ts-expect-error`, `@ts-ignore`, `oxlint-disable`, `eslint-disable`, `type: ignore`, `noqa`, `pragma` etc.) stay forbidden. CI does not check this; review does.
- UI work follows `DESIGN.md` (theme, colors, radius, typography, motion).

## Branches and CI
- Small commits. Before every push, run the checks for the area you touched, then a plain `git push`.
- A change that touches the UI shows before and after screenshots on its PR. Attach them with `--attach` on `gh pr create`, `gh pr edit` or `gh pr comment` (for example `gh pr comment <N> --attach ./before.png --attach ./after.png`), which needs `gh` 2.99.0 or newer. If `gh --version` is older, ask the human to consider upgrading it. Until they do, push the shots to the `pr-shots` branch under `<PR number>/` and link them in the PR as `raw.githubusercontent.com` URLs at that commit.
- Long-running processes (CI, checks, tests, builds, servers, waiting on a CI run) run detached, in background, so a turn interruption does not kill them: start them with the agent tool's background mode or, in the shell, with `nohup <command> > file.log 2>&1 &` (or `setsid`), never with a bare `&`, which does not detach the process from the shell; send output to a log file and follow the log or the completion notice instead of blocking the turn waiting.

## Authorship

- PRs and Issues: if wrote by AI agent plz disclose with `{model_slug} on behalf of {human_name}`.
- A PR whose disclosure, or a commit's `Agent:` line, names a model listed in `.github/quarantine.json` is quarantined: the kiwi-bus bot turns it into a draft with the `quarantine` label and says why. It stays there until a person on that file's vouched list, or a stronger model on their behalf, reviews it and comments `/vouch`.
