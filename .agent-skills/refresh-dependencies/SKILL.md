---
name: refresh-dependencies
description: Refresh every Bun workspace dependency to what `ncu --workspaces --root` reports, move the pinned surfaces outside npm (Android, Electrobun/Livewire, GitHub Actions) when they have releases, and deliver the result as one issue and one PR. Use when asked to update or refresh dependencies, apply an ncu inventory, or take a specific dependency major.
---

# Refresh dependencies

`AGENTS.md` owns the branch, CI and authorship rules. This file adds only what
is specific to a dependency refresh. The precedents are #1014/#1016 (JavaScript,
Android and Electrobun together), #1051 (a Livewire re-pin on its own) and
#1062/#1066 (replacing a tool outright).

## Set up

1. `git fetch origin main`, then check that nobody is already doing this:
   `gh pr list --repo kiwi-init/channels --search "deps in:title"`.
2. Take the inventory (step 1 below) before filing anything. It decides how
   big the PR is.
3. Open the issue first. Its body starts with the `Agent:` line and states the
   inventory, the majors and anything you will hold back.
4. Branch `<issue>-refresh-deps` from `origin/main`.

Keep every log outside the repository (your scratchpad). `.scratch/` is not
ignored here.

## 1. Take the inventory

`ncu` (npm-check-updates) is installed globally, not declared in any manifest.

```
ncu --workspaces --root > <scratch>/ncu-before.txt
```

Read every section: the root, `packages/core`, `web`, `ui` and `desktop`.
One package often appears in several of them, and the sections drift apart:
on 2026-10-28 `ui` declared `oxlint` 1.86.0 and `oxfmt` 0.71.0 while the root
and `web` were on 1.89.0 and 0.74.0. After the refresh, every manifest that
declares a package must declare the same version. Grep the manifests for each
old version and confirm that none is left.

Things ncu does not move, or must not:

- The `version` fields in `package.json` and `desktop/package.json`.
  `scripts/stamp.ts` writes them at release.
- `ui/stubs/react-native`, the `file:` override in the root `overrides`.
- `electrobun` in `desktop/package.json`. It is the npm shim for the Livewire
  build pinned in `desktop/electrobun-pins.json`, and it moves only with those
  pins (step 4).
- `tsrs` is a beta pinned exact. ncu follows its beta line
  (`0.20.0-ts7.1.0-beta` to `0.20.1-ts7.1.0-beta`), so take that bump, but
  read the tsrs release notes for checker changes first.

## 2. Apply and install

```
ncu --workspaces --root -u
bun install
bun install --frozen-lockfile
```

Confirm with `git diff --stat` that only dependency blocks and `bun.lock`
changed. Never resolve a conflicted `bun.lock` by hand: take `origin/main`'s
copy and run `bun install` again.

## 3. Decide each major out loud

ncu lists majors, and `0.x` minors (which ncu labels "Anything may change"),
next to patches. Each one is a decision you record in the PR, not a version
that rides along. Read the upstream breaking changes, grep the repo for every
symbol they name, and write down what the repo actually uses. For the oxc tools
(`oxlint`, `oxfmt`, `oxc-parser`), run `bun run lint` and `bun run format:check`
and treat new findings or format churn as part of the decision. Fix them in
the same PR, or hold the bump and say so.

A major blocked by another dependency's pin is the owner's call, not a skip.

## 4. Surfaces outside npm

Look at each one and say in the PR whether it moved.

- **Android:** `android/gradle/libs.versions.toml` and
  `android/gradle/wrapper/gradle-wrapper.properties`. Compare each entry with
  its latest stable release. Regenerate the wrapper with Gradle's `wrapper`
  task, not by editing the properties file. #1016 is the template, including
  the AGP migration notes.
- **Electrobun/Livewire and Hutch:** only when kiwi-init/electrobun-livewire
  has a new release. Update `desktop/electrobun-pins.json` and run
  `bun desktop/scripts/eb-pins-check.ts macos-arm64 linux-x64 linux-arm64`.
  Record which pinned files changed and why, as #1051 does. New pins are
  reviewed like code.
- **GitHub Actions:** every `uses:` is a full 40-character SHA, enforced by
  `bun scripts/action-pins.ts`. To bump one, resolve the new tag with
  `gh api repos/<owner>/<repo>/commits/<tag> -q .sha` and keep the tag in the
  comment beside the SHA.
- **iOS:** the Xcode project has no third-party packages. Nothing to refresh.

## 5. Size budgets

A refresh can push a bundle over its gate:

- The CLI bundle: `BUDGET_BYTES` in `scripts/build-cli.ts`, checked by
  `bun run build`.
- The web bundle: `bun scripts/web-bundle.ts`.
- The desktop images: `desktop/scripts/eb-size.ts`.

Raising a budget needs the owner's approval in words. Quote the measured size
in the PR, as #1016 does for the AppImage.

## 6. Gate

There is no `verify` script. Run these once each, output to a log, and read
the logs:

```
bun run typecheck
bun run knip
bun scripts/action-pins.ts
bun run build
bun run web:build && bun scripts/web-bundle.ts
bun run ui:build
bun run smoke:ui
bun scripts/ci-tests.ts unit
bun scripts/ci-tests.ts flows
```

Some tests fail because of the host, not the change. For example,
`harnesses.test.ts` finds a `cursor-agent` installed in `/usr/bin`. Confirm
such a failure on `origin/main` before you set it aside.

A PR's CI runs only `repo / static` and `test / unit`, and a refresh reaches
every job. Dispatch the rest on the branch:

```
gh workflow run ci.yml --ref <branch> -f jobs=build,shots,desktop-mac,desktop-linux,cli-macos,ios,android
```

Before accepting a workaround for a failure (a pin, a shim, a suppressed
rule), search upstream for a released fix, and record what you found.

## 7. Done and delivered

The refresh is done when `ncu --workspaces --root` reports nothing except the
holds you recorded. Paste that output into the PR.

PR title: `Deps: refresh <surfaces>`. The body starts with the `Agent:` line,
then `Closes #N.`, then:

- **What changed:** each surface, each major with its decision, and any
  budget change.
- **Verification:** the commands from step 6 with their pass counts from your
  own run, plus the dispatched CI run's URL.

An independent reviewer's PASS and a green `ci-ok` come before merge.
