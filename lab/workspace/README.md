# lab / workspace

A prototype, not part of Kiwi. One Cloudflare Durable Object holds a git repository in its SQLite and serves copy-on-write worktrees for any number of agents. Agents work in them with a [just-bash](https://github.com/vercel-labs/just-bash) shell that has a `git` command. Nothing touches a disk or spawns a process: git is [isomorphic-git](https://isomorphic-git.org) over a file system made of SQLite rows.

The research behind it, and what it could become in Kiwi, is in [docs/plans/edge-workspaces.md](../../docs/plans/edge-workspaces.md).

## What it does

```
POST /ws/<name>/clone      {url}                 shallow clone into the DO (git smart HTTP)
POST /ws/<name>/worktrees  {name, from?}         branch agent/<name> + an empty overlay: O(1)
POST /ws/<name>/exec       {worktree, script}    run a bash script in that worktree, at /work
POST /ws/<name>/merge      {worktree}            merge agent/<name> into main (ff or 3-way)
POST /ws/<name>/push       {url, ref, remoteRef} push a branch back to any git remote
GET  /ws/<name>/stats                            bytes, rows, branches, worktrees
```

Inside `exec`, the shell has every just-bash command (grep, rg, sed, awk, jq, find, diff…) plus `git status | diff | add | commit -m | log [-n N] | branch | rev-parse`.

## How it works

| Piece | File | What |
| --- | --- | --- |
| Rows | `src/store.ts` | `node(space, path, kind, mode, mtime, size, target)` and `chunk(space, path, idx, data)`, 1 MB chunks (DO SQLite caps a value at 2 MB). A *space* is either the git directory or one worktree's overlay. |
| git's file system | `src/gitfs.ts` | The `fs.promises` contract isomorphic-git expects, on the `git` space. The clone's packfile and every new loose object live here. |
| A worktree | `src/tree.ts` | No checkout. A worktree is its branch's commit (read lazily from git objects) plus an overlay of changed rows and whiteouts. Creating one writes one ref. `commit` hashes only the overlay, writes blobs and trees, moves the branch and clears the overlay. |
| The shell's file system | `src/wtfs.ts` | just-bash's `IFileSystem` over a worktree, mounted at `/work` in a `MountableFs` whose base is an in-memory `/tmp`, `/dev`, `/bin`. |
| `git` in the shell | `src/gitcmd.ts` | A just-bash custom command. `git diff` writes both sides to `/tmp` and runs just-bash's own `diff -u`. |
| The Worker | `src/worker.ts` | Routes `/ws/<name>/…` to `Workspace`, the Durable Object. |

## Run it

```bash
cd lab/workspace
bun install
bun run typecheck
bun run e2e          # serves a bare copy of this repo over git http-backend, starts wrangler dev, runs the whole story
bun run dev          # or poke it by hand on :8787
```

`scripts/e2e.ts` is the CI gate (`lab / workspace`). It clones this repo into the DO, gives three agents worktrees, has them edit the same tree at the same moment (append to a file, add a directory, delete a file), checks they can't see each other, merges all three into main, checks a conflicting fourth merge is refused, pushes main back to the origin and runs `git fsck --strict` there.

## Measured (wrangler dev on one Linux container, this repo at 51c8938: 359 files)

| Step | Time |
| --- | --- |
| Shallow clone into the DO (1.25 MB stored) | 250–340 ms |
| Create a worktree | 1–2 ms |
| 50 worktrees, requested at once | 280 ms wall |
| Agent script: `sed -i` + `git status` + `git diff` | 24 ms |
| Agent script: `ls`, `wc -l src/relay/*.ts`, `grep -rn` | 91 ms |
| `git commit` from a worktree | 30–90 ms |
| Merge into main (ff / 3-way) | 3–65 ms |
| Push main to the origin | 127 ms |
| 50 agents at once: grep + edit + commit each | 4.9 s wall, about 100 ms each (one DO runs them in turn) |
| Storage after those 50 commits on 51 branches | 1.25 MB → 1.56 MB |

Uncommitted overlay edits survive killing workerd and starting it again: the worktree is rows, not memory.

## Limits it does not hide

- isomorphic-git reads a whole packfile into memory, and a Worker has 128 MB. Shallow, single-branch clones of ordinary repos fit. A monorepo doesn't; that is what Cloudflare Artifacts or a container is for.
- isomorphic-git merges are basic: no rename detection, and a conflict throws instead of leaving markers.
- One DO runs one request at a time. Keep the repo in its own DO, never in a channel's room.
- `exec` runs with just-bash's defense-in-depth off: workerd exposes `registerHooks` but throws "not implemented", so turning it on breaks every command (Cloudflare's own `@cloudflare/computer` does the same). There is still no path from a script to JavaScript evaluation, no network and no python or js-exec.
- There is no auth, no E2E, and no wipe on close. It is a lab.
