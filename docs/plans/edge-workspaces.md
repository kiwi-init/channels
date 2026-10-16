# Research: what Workers, Durable Objects and just-bash make possible for Kiwi

> Owner's ask (2026-10-16): "do deep research of what we could do with cloudflare workers, durable objects and just-bash … could we clone a repo on a channel and agents can edit and create worktrees from it, instead of depending on my machine filesystem? … surprise me with amazing revolutionary and crazy ideas … i want to think holy fuck i didn't know this was possible."
>
> This is research, not a decided plan. Every idea below names what it would cost Kiwi's promises, especially "the relay never sees content".
>
> State of the platform is as of 2026-10-16. It was read from the `cloudflare/cloudflare-docs` source at commit `f775315` (developers.cloudflare.com itself is not reachable from the research sandbox) and the npm registry. Items marked *unverified* rest on search snippets only.

## TL;DR: the six things worth waking up for

1. **Yes, a channel can hold the repo, and it already runs here.** [`lab/workspace`](../../lab/workspace) is a Durable Object that clones this very repo into its SQLite in about 0.3 s. It hands out git worktrees to agents in **1–2 ms each**, because a worktree is a branch plus an empty overlay, not a checkout. Agents get a real bash, just-bash with `grep`, `sed`, `jq` and a `git` command, inside the DO. Three agents edited the same tree at the same moment and stayed isolated. The DO merged all three into main and refused the one conflicting merge. It then pushed back to the origin, and `git fsck --strict` passed. 50 worktrees cost 0.3 MB of storage. Uncommitted edits survive a runtime restart. CI runs the whole story (`lab / workspace`).
2. **Cloudflare is building the same thing for single agents, which means we're early, not wrong.** In 2026 they shipped:
   - **Artifacts**, "Git for agents": a repo per agent, `fork()`, smart-HTTP remotes. Open beta since 2026-10-01.
   - **`@cloudflare/computer`**, just-bash plus a SQLite filesystem in a DO, in preview.
   - **`@cloudflare/shell`**, isomorphic-git over a DO workspace.
   - **Sandbox SDK 1.0**, where a DO drives a Firecracker VM directly.

   All of these are one agent, one sandbox. None of them does what Kiwi does: **many agents from many machines and models, human-approved, end-to-end encrypted, coordinating on one codebase.** The channel is the missing layer.
3. **The relay can host a repo without being able to read it.** Agents use real `git` against `kiwi::` remotes. A git remote helper seals every object with a key that only travels inside E2E messages, and the DO stores ciphertext. It also does **compare-and-swap on encrypted refs**, so pushes are linearizable while the relay stays blind. The result: `git clone kiwi::mc2-…` works on any approved machine, and our promise holds (§4.1).
4. **A workspace can be a *member* instead of the relay**, for when you want cloud execution. It is an identity the owner approves in the app like any agent. It gets the **workspace key but not the channel key**, so it can run on the code and still cannot read the conversation (§4.2).
5. **Agents can stop needing machines at all.** Cloudflare now runs whole harnesses inside a DO: OpenCode 2.0 since 2026-10-12, a Pi harness, Think. Put one in a channel seat with the workspace and you get a coding agent that sleeps for free and wakes on a message. Kiwi's hardest problem, waking agents, disappears for that seat (§5, idea 17).
6. **Most of it fits the Free plan.** SQLite DOs, alarms, hibernating sockets, Workers VPC/Mesh (beta), Email Routing and Workflows are all on Free. Containers, Dynamic Workers, Artifacts and email sending are Paid ($5/month and up). Each idea below says which.

## 1. Where Kiwi stands, and what any idea has to respect

- **Relay.**
  - A Worker (`src/relay/worker.ts`) with one SQLite Durable Object per channel (`Channel`), plus `Owners` and `MailboxBox`.
  - It stores `{seq, ts, iv, ct, e}`, member public keys, owner-signed wrapped keys, join requests and read marks. It sees timing, sizes, counts and keys, and never content (SECURITY.md §"What the relay sees").
  - Hibernating WebSockets with auto-pong. `eph` frames are encrypted, never stored, at most 4 KB and 60/min.
  - Limits: 512 KB per message, 10,000 messages and 1 GB per channel.
  - It fits the Free plan at roughly 100k messages/day overall.
- **Clients fold state.** Tasks, review rounds at a commit, facts/notes, charter, hold, scopes and roles are signed events that every client folds the same way (`src/state.ts`). The relay enforces only `read_only`.
- **just-bash is already in the product, on the client.** `kiwi sh` and the MCP `sh` tool give an agent the channel as read-only files (`/channel/log.jsonl`, `tasks/T12.md`, `members/*.json`…). The hardened profile is on, with no network and no interpreters (`src/sh.ts`).
- **Hard constraints** (README, SECURITY.md, AGENTS.md, `docs/plans/beta-quotas-selfhost.md`):
  - E2E: the relay never reads content, and quotas use only metadata.
  - The owner approves every member, and owner keys live only in the app. Admin happens only in the app.
  - People direct agents; agent consensus never counts as an order.
  - The Worker relay and the Bun relay behave the same.
  - Closing or expiring a channel leaves nothing behind.
  - Costs stay bounded: the owner pays out of pocket.
  - Repo rules: no comments in code, strict types, a CI gate per change.

## 2. The platform today (October 2026): what's on the table

| Piece | What it gives us | Plan | Status |
| --- | --- | --- | --- |
| **Durable Objects, SQLite** | 10 GB per object (5 GB per account on Free). Synchronous `sql.exec`. 2 MB per row/BLOB. 128 MB memory. 30 s CPU, configurable to 5 min. Alarms. 32k hibernating sockets. Outbound `fetch`, WebSocket and TCP `connect()`. | Free + Paid | GA |
| **DO point-in-time recovery** | Restore a whole object to any second in the last 30 days (`getBookmarkForTime` → `onNextSessionRestoreBookmark`). The restore itself can be undone. Not in local dev. | SQLite DOs (Free unverified) | GA |
| **DO keep-alive** | Pending I/O (RPC, `waitUntil`, timers, outbound sockets) keeps a DO alive for up to 15 min per operation (compat date ≥ 2026-10-01). | both | new |
| **Containers / Sandbox SDK 1.0** | A Firecracker VM per DO. 1–3 s cold start. `lite` (1/16 vCPU, 256 MiB) up to 4 vCPU / 12 GiB. A DO starts it with `ctx.container.start({image, instance})`. Snapshots up to 20 GB, kept 30 days. Streamed exec, PTY, preview URLs, R2 mounts. Outbound Workers inject credentials. | Paid | GA (2026-04-13); 1.0 on 2026-09-30 |
| **Dynamic Workers (`env.LOADER`)** | Load code at runtime into a fresh isolate, with `globalOutbound: null` to cut the network. **DO Facets** give that code its own SQLite inside your DO. $0.002 per Dynamic Worker per day after 1,000 per month. | Paid | open beta |
| **Code Mode** | The model writes TypeScript against typed tools, and it runs in a Dynamic Worker. | Paid (needs loader) | experimental |
| **Artifacts** | Git repos for agents, with smart-HTTP remotes and scoped tokens (`art_v1_…`). The binding has `fork()`, `readFile`, `readTree` and `log`. Events on push/fork. 1 GB per repo, 32 MB per file. 10k ops/month, then $0.15 per 1k. ArtifactFS does lazy FUSE hydration. | Paid | open beta 2026-10-01, billed from 2026-10-14 |
| **`@cloudflare/computer` 0.5.1** | A SQLite VFS in a DO, with backends for just-bash in a Dynamic Worker or a container through FUSE. Includes a git client and AI SDK tools. | Paid (loader) or none (fs only) | preview, "not for production" |
| **`@cloudflare/shell` 0.4.3** | A `Workspace` on DO SQLite (+R2), `createGit` (isomorphic-git), and `gitTools` with auth injected. | — | experimental, superseded by computer |
| **Agents SDK 0.28** | Agent = DO with synced state, `schedule()`, sub-agents, Workflows. Harnesses: Think, Pi, OpenCode 2.0 in a DO. Voice, email, Slack channels. `createMcpHandler` (MCP 2026-07-28; `McpAgent` deprecated). x402/MPP payments. | Free + Paid | active |
| **Workflows** | Durable steps that can sleep up to 365 days. Cron on the binding. | Free (100 concurrent, 3k steps/day) + Paid | GA |
| **Browser Run** (formerly Browser Rendering) | Playwright/Puppeteer/CDP, Live View, human-in-the-loop, recordings. | Free 10 min/day; Paid | GA |
| **Workers AI** | Whisper / nova-3 STT, Aura TTS, bge/qwen3 embeddings, gpt-oss, kimi-k2.7-code, deepseek-v4… | Free 10k neurons/day | GA |
| **AI Search, Vectorize, Agent Memory** | Hybrid RAG (AI Search GA 2026-10-01), vectors, managed memory (private beta). | mixed | — |
| **Realtime SFU WebSocket adapter** | PCM audio and JPEG frames straight into a DO. | Paid-ish (1 TB free egress) | GA 2026-09-30 |
| **Email** | Routing (inbound) on any plan. Sending from a Worker is Paid. | Free in, Paid out | sending in beta |
| **Workers VPC + Cloudflare Mesh** | A Worker or DO can `fetch()` or `connect()` to private IPs of enrolled machines or tunnels. | Free during beta | beta |
| **Temporary accounts** | `wrangler deploy --temporary`: a 60-minute deploy that an agent can make and a person can claim. | — | new |

Vercel's **just-bash 3.6.0** (latest; 3.5.0 was never published):
- A bash interpreter written in TypeScript: pipes, functions, arrays, here-docs, process substitution, `set -euo pipefail`, about 80 commands. No processes and no job control; pipelines are materialized, not streamed.
- **Any file system is pluggable** through a 20-method async `IFileSystem`. That interface is what both our prototype and Cloudflare's products plug into.
- Custom commands (`defineCommand`, `origCommand` to wrap a built-in), AST transform plugins, and curl with a URL allow-list that injects headers.
- On workerd:
  - Use the `just-bash/browser` entry. It has no `node:` imports and works with `nodejs_compat`; we verified this.
  - Turn defense-in-depth **off**. workerd throws on `registerHooks`. Cloudflare does the same.
  - python, js-exec and sqlite3 need `worker_threads`, so they don't run.
- Related libraries: **just-git** (pure-TS git written *as a just-bash command*, with an embeddable server) and **Turso AgentFS** (a SQLite fs with whiteout/origin overlays and a tool-call audit log, with an adapter for just-bash on DOs).

## 3. The prototype: a repo in a Durable Object, worktrees in milliseconds

Everything below exists in [`lab/workspace`](../../lab/workspace) and runs in CI.

```
              agent A (Claude, Mac)      agent B (Codex, VPS)      agent C (cloud)
                     │ exec "sed …; git commit"  │ exec "rg …"             │ exec …
                     ▼                           ▼                         ▼
   ┌───────────────────────────── Workspace Durable Object ─────────────────────────────┐
   │  just-bash  ──  MountableFs:  /work → WorktreeFs(A | B | C)    /tmp,/dev → memory  │
   │                     │                                                              │
   │   worktree = branch commit (lazy, from git objects)  +  overlay rows + whiteouts   │
   │                     │                                                              │
   │   isomorphic-git  ──  GitFs  ──  SQLite: node(space, path, …), chunk(…, 1 MB)      │
   │   clone · writeBlob/Tree/Commit · merge · push            (one object store)       │
   └─────────────────────────────────────┬──────────────────────────────────────────────┘
                                         │ git smart HTTP (clone, push)
                                    GitHub / Artifacts / any remote
```

### Key design choices

- **A worktree is not a checkout.**
  - `git worktree add` copies every file. Here a worktree is `(branch, commit)` plus an overlay that starts empty, so creating one writes a single ref.
  - A read falls through overlay → whiteout → the commit's tree, which is read lazily from git objects and cached by immutable oid.
  - `git status` only hashes overlay rows. `git commit` writes blobs for overlay rows, rebuilds only the trees on changed paths, and moves the branch.
  - This is the jj / AgentFS idea (working copy as a delta over a commit) on top of real git objects.
- **One SQLite, two kinds of space.** The git directory (packfile, loose objects, refs, config) and every overlay share one `node` table and one `chunk` table. Chunks are 1 MB, under the 2 MB per-value cap.
- **The shell sees a normal Unix tree.** `/work` is the worktree, and `/tmp`, `/dev` and `/bin` are in memory. `git diff` writes both sides to `/tmp` and runs just-bash's own `diff -u`. So the "git" an agent uses is a tiny TypeScript command, and everything else is stock bash tooling.
- **Merge queue.** `merge` runs isomorphic-git's merge from `agent/<name>` into `main` inside the DO: fast-forward or 3-way, refusing conflicts.
- **Push** goes straight from the DO to any remote. The test pushes to a git http-backend, then runs `git fsck --strict` on the result, so the objects we write by hand are real git.

### Numbers

Measured on wrangler dev (workerd) on one Linux container, with this repo at 51c8938 (359 files):

| | |
| --- | --- |
| Shallow clone into the DO | 250–340 ms, 1.25 MB stored |
| New worktree | 1–2 ms |
| 50 worktrees requested at once | 280 ms wall |
| `sed -i` + `git status` + `git diff` | 24 ms |
| `ls`, `wc -l src/relay/*.ts`, `grep -rn MAX_CT_LENGTH src` | 91 ms |
| `git commit` | 30–90 ms |
| merge (ff / 3-way) | 3 ms / 20–65 ms |
| push | 127 ms |
| 50 agents at once, each grep + edit + commit | 4.9 s wall (≈100 ms each; one DO runs them in turn) |
| storage after 50 commits on 51 branches | 1.25 → 1.56 MB |
| kill workerd, start again | uncommitted edits still there |

### What it doesn't solve yet

- **Big repos.** isomorphic-git loads the whole packfile into memory, and a Worker gets 128 MB.
  - Shallow single-branch packs up to a few tens of MB are fine (estimate). A monorepo is not.
  - Ways around it: explode the pack into object rows in alarm-sized batches after clone, use Artifacts as the object store, or use a container.
- **Merges.** isomorphic-git has no rename detection, no recursive strategy, and conflicts throw. For agents that's arguably fine: a refused merge becomes a message to the agent ("rebase on main, README.md conflicts").
- **One DO is one thread.** Run the repo in its own DO (`idFromName(room + ':ws')`), never in the `Channel` room, so a 300 ms clone never stalls chat.
- **Execution.** just-bash can't run `bun test`. That needs a container (§5, idea 12).
- **No auth, no E2E, no wipe on close.** That's what §4 is for.

## 4. The trust question, answered three ways

Kiwi's core promise is that the relay never sees content. A repo the DO can read breaks that. Instead of choosing once, give the owner three tiers and make each one visible in the app.

### 4.1 Tier 0, the blind remote: `git clone kiwi::…`, and the relay can't read a byte

Real git runs on each agent's machine. A **git remote helper**, `git-remote-kiwi`, which is a tiny addition to the existing CLI, speaks to a `Repo` DO that only stores ciphertext.

- **The key.** The owner (or any member allowed to) posts `repo.create {name, key: Kr}` *inside an E2E message*. Every member who can read the channel can read the repo, and the relay never sees `Kr`.
  - Removing a member rotates: the next `repo.key` event carries `Kr2`, and new objects use it. This is exactly the epoch model messages already use.
  - **New:** a member who can't read the channel can still be given `Kr` sealed to its X25519 key. That makes "code access without chat access" possible (tier 1).
- **Objects.** `id = HMAC-SHA256(Kr, oid)`, `blob = AES-256-GCM(Kr, deflate(object), aad = id)`.
  - Push sends one sealed pack per push, plus a sealed index. That is the git-remote-gcrypt pattern, with storage-friendly framing.
  - The DO stores rows it cannot open: chunked, content-addressed by an id it cannot invert.
- **Refs with blind compare-and-swap.** A ref is `HMAC(Kr, refname) → (version, sealed{oid, signer, sig})`. The pusher signs the new value with their member key, and the DO accepts only `PUT if version == v`.
  - Concurrent pushes are linearized by a party that knows nothing.
  - Clients verify the signer is a member, so a malicious relay can withhold or roll back but can't forge. That is the same guarantee messages have.
- **Worktrees** are local and normal (`git worktree add`), or cloud ones as in tier 1. Uncommitted work can be parked as a sealed `wip` ref per agent, so the work survives the laptop closing.
- **What this unlocks with zero trust change:**
  - "Clone the channel's repo" on any approved machine.
  - A `kiwi task review T3 --at <sha>` reviewer fetches that exact commit from the channel itself.
  - Handovers carry code, not just a note.
  - The repo is wiped when the channel closes, like everything else.
- **Free plan:** objects are DO rows, so a 50 MB repo is about 25 rows per MB plus a few hundred requests per push.

This is the flagship because it is the only design where *more capability costs nothing in privacy*.

### 4.2 Tier 1, the hosted member: a workspace that joins the channel

When people want cloud worktrees, a shared shell or a merge queue that runs without anyone's laptop, the workspace **becomes a member** instead of the relay.

- It has its own Ed25519/X25519 identity, generated and kept in its DO.
- The owner approves it in the app like any agent, with an SAS code. Its card says `runs: cloudflare-durable-object`, and the app shows it with a distinct "hosted" badge: *this member runs on Cloudflare and can read what it's given*.
- **Least privilege by construction:** it receives `Kr` (the code), not the channel key (the chat). It executes on the repo and never reads the conversation. If the owner wants it to (for idea 17), they grant the channel key, and the app says so.
- Every write it makes is a signed event like any agent's: `ws.commit`, `ws.merge`. The fold stays authoritative.
- Removing it in the app revokes it and rotates the keys, the same as any member.

This is the prototype plus an identity, `kiwi ws exec|worktree|merge` verbs and matching MCP tools, and a `/work` mount in `kiwi sh`.

### 4.3 Tier 2, the hosted machine: the same, plus a real Linux

Tier 1 plus a container from the same DO (`ctx.container.start`), for `bun test`, builds and browsers. It is Paid. A snapshot with dependencies already installed restores in seconds.

| | Relay sees code | Needs anyone's laptop | Runs tests | Plan |
| --- | --- | --- | --- | --- |
| Tier 0 blind remote | never | the agents' own | on agents' machines | Free |
| Tier 1 hosted member | the member does; the relay doesn't | no | bash/grep/git only | Free (DO) |
| Tier 2 hosted machine | the member does | no | yes | Paid |

## 5. The idea catalogue

Each idea lists its trust tier, its effort (S/M/L), and whether it fits **Free**, needs **Paid**, or falls **Between**. Ideas we'd filter still get their concept extracted, because you asked for that.

### A. Code lives in the channel

1. **Channel workspace.** *T1 · M · Free.* The prototype as a member: a repo per channel, a worktree per agent seat, `kiwi ws exec`. The seat already binds an agent to a folder; now it can bind to a cloud worktree too. The win is that "my machine's filesystem" stops being the shared truth.

2. **Conflict radar.** *T1 · S · Free.*
   - On every commit, the DO runs `merge({dryRun})` of each live agent branch against every other, at about 20 ms each.
   - When two branches collide it posts *before anyone finishes*: "@otter-gentle and @heron-brave both changed `src/protocol.ts:10`".
   - Today agents discover conflicts at PR time. In a channel they would discover them while typing.

3. **Path leases.** *T0/T1 · S · Free.*
   - `kiwi lease src/relay/**` is a signed, expiring claim that every client folds, so other agents are told before they edit.
   - The workspace can *enforce* it: writes outside your leases fail with "leased by @otter until 14:20".
   - The old `claim`/`release` events, which fold to nothing today, come back with a meaning.

4. **Review rounds you can actually check out.** *T0/T1 · S · Free.*
   - `kiwi task review T3 --at <sha>` already pins a round to a commit.
   - With a workspace, the reviewer gets a worktree at that sha in 2 ms, and `approve --round 2` is bound to a tree hash nobody can change afterwards.
   - The app renders the round's diff from the channel instead of from GitHub.

5. **Time machine.** *T1 · S · Free or Paid (the docs don't say whether PITR is on Free; unverified).*
   - DO point-in-time recovery restores the whole workspace — every branch, every agent's uncommitted overlay — to any second in the last 30 days, and the restore can itself be undone.
   - "Rewind the channel's code to 14:03 yesterday, before the agents went sideways."
   - A finer version: a jj-style operation log table, so each agent can undo its own steps.

6. **Best-of-N in milliseconds.** *T1 · S · Free.*
   - Worktrees are copy-on-write, so ten attempts at one task cost ten empty overlays.
   - Fan a task out to Claude, Codex and Kimi seats, each in its own worktree. The channel compares diffs, tests (tier 2) or a reviewer's verdict, and merges the winner.
   - The task board gains "attempts".

7. **The laptop closes, the work doesn't.** *T0/T1 · S · Free.*
   - An agent's uncommitted state lives in its overlay (T1) or its sealed `wip` ref (T0).
   - `kiwi task assign T3 win "…"` hands over the worktree itself, and the next agent continues mid-edit on another machine.

8. **Pair shell.** *T1 · M · Free.*
   - A shell session per worktree whose commands and outputs stream as `eph` frames, which are encrypted and never stored.
   - People and other agents watch an agent work live in the app, and can replay it, since each exec is a row.

9. **`kiwi sh` sees the code.** *T0/T1 · S · Free.*
   - Mount `/work` next to `/channel`.
   - One script can join the task board with the tree, for example: `for t in $(grep -l 'state: doing' /channel/tasks/*.md); do …; git -C /work log --grep "$(basename $t .md)"; done`.
   - The read-only shell agents already have becomes the best repo query tool in the product.

10. **Artifacts as the big-repo backend.** *T1 · M · Paid.*
    - Same API, but objects live in Cloudflare Artifacts: 1 GB repos, `fork()` per agent, ArtifactFS for containers.
    - The DO keeps overlays, leases and the merge queue. Artifacts keeps the bytes.
    - Use it once a repo outgrows a 128 MB isolate.

11. **GitHub bridge.** *T1 · M · Free.*
    - A GitHub App's key lives in a Worker secret, and installation tokens last an hour.
    - The workspace opens PRs, and GitHub's `createCommitOnBranch` (with `expectedHeadOid` as a CAS) makes **verified, signed commits** without git at all.
    - CI results and review comments flow back as channel messages addressed to the agent that owns the branch.

### B. Execution without anyone's machine

12. **Post-merge verification.** *T2 · M · Paid.*
    - The merge queue only lands a branch after `bun test` passes in a container restored from a dependency snapshot.
    - The verdict is posted as a review round by a hosted "CI" member, so "approved by" can be a test run.
    - About 40% of active repos have parallel agent PRs, and the main failure is a *semantic* conflict (it merges cleanly and breaks) *(unverified preprint)*. This idea catches exactly that.

13. **Agents ship tools to the channel.** *T1 · M · Paid.*
    - An agent writes a TypeScript function. The owner approves it in the app, which signs it.
    - The relay's DO loads it into a Dynamic Worker with `globalOutbound: null`, plus a Facet for its own SQLite.
    - From then on it is a command in everyone's `kiwi sh` and a tool in everyone's MCP.
    - **The channel learns skills.** The governance already exists: people decide, and agents request.

14. **Code Mode for Kiwi.** *T1 · S · Paid.* Replace 18 MCP tools with one `run` tool and a typed `kiwi.*` API (`kiwi.tasks.claim("T3")`, `kiwi.ws.exec(…)`). There are fewer tokens per turn, and agents compose steps in one call.

15. **Preview URLs per worktree.** *T1 · S · Free.*
    - A Worker serves any worktree's static files at `https://<room>--<worktree>.preview.<domain>`, behind a member-signed link.
    - This repo's `site/` is plain static files, so humans could click through each agent's version of the landing page today, with no container.
    - Containers extend it to dev servers (Paid).

16. **Eyes.** *T2 · S · Free tier (Browser Run, 10 min/day).* A hosted member opens a preview URL in Browser Run and posts a screenshot. Messages already carry images, so this needs no protocol change. Its output: "here's heron's branch of the landing page, the hero is broken at 375 px".

### C. Agents that live in the channel

17. **A seat with no machine.** *T1 (with chat access) · M · Free-ish.*
    - Cloudflare now runs coding-agent harnesses inside a DO: OpenCode 2.0, Pi, Think.
    - Give one a Kiwi seat, the workspace and an AI Gateway key. It hibernates at zero cost, and the relay's own message is what wakes it. That makes `wake.ts`'s whole table moot for that seat.
    - The owner adds "a cloud agent" from the app the way they add a computer today.

18. **Rituals.** *T1 · S · Free.*
    - Alarms and Workflows `sleep` (up to 365 days) give the channel a pulse: a stand-up digest at 9:00, a nudge on tasks idle for 2 days, expiry reminders for notes.
    - Today only clients can do this, because only they read content. A hosted member with chat access can.

19. **Memory that knows the code.** *T1 · M · Free/Paid.*
    - Workers AI embeddings plus Vectorize or AI Search over history and code: "who changed the auth flow and why", answered with message links and commits.
    - It needs plaintext, so it is a hosted member's job. Embeddings stored relay-side would leak meaning, so they stay in the member's own DO storage.

20. **Call your channel.** *T1 · L · Paid.*
    - The Realtime SFU's WebSocket adapter streams audio into a DO, and Workers AI transcribes it (nova-3 / whisper).
    - A person *says* "otter, drop the NOTICE change and take T7" from their phone. It lands as a signed message from that person, sent by their app, which holds their key. Agents can answer with Aura TTS.

21. **The channel has an email address.** *Sealed · S · Free (in).*
    - Email Routing delivers `T-<room>@…` to the Worker, which **seals it to the channel's inbox key on arrival and keeps nothing** (idea 22).
    - Forward a customer's bug report and it becomes a task.
    - Sending digests out is Paid.

### D. Bending the infrastructure

22. **Sealed inbox: webhooks into an E2E channel.** *T0-ish · S · Free.*
    - The owner publishes an X25519 *inbox key* in the channel's sealed settings.
    - The Worker accepts a webhook (Sentry, GitHub, Stripe, Email), seals the body to that key, stores it as a message from "inbox", and forgets the plaintext. Only clients can open it.
    - The relay sees the payload exactly as long as a TLS terminator would, and the app says so.
    - This turns Kiwi into a place where *the world* talks to the agents.

23. **The relay can reach your machines.** *Infra · M · Free (beta).*
    - Workers VPC with Cloudflare Mesh lets a DO `fetch()` or `connect()` to private IPs of enrolled machines.
    - Paired computers could become Mesh nodes. Then the relay delivers a wake straight to the daemon without the daemon holding a socket open, and a hosted member can screenshot `localhost:3000` on a person's laptop. It all goes through the same pairing the app already does.

24. **A daemon for people without a VPS.** *T1 · M · Free.* `kiwi daemon` as a DO: it holds hosted seats' connections, wakes them through their harness's HTTP API, and keeps cursors.

25. **Throwaway relays.** *Infra · S · Free.* `wrangler deploy --temporary` gives a real relay at the edge for 60 minutes, with no account. `kiwi demo` could play on the real network, and a self-hoster can try it before committing.

26. **Relay parity stays easy.** *Infra · S.*
    - The prototype's store needs only `exec(sql, …args)`. That is the same seam `RoomDb` uses with its injected `Sql { run, all }`.
    - The Bun relay can host workspaces with `bun:sqlite` and isomorphic-git, unchanged.

### E. The crazy ones (filter freely; concepts worth keeping in bold)

27. **The channel is a filesystem on every machine.**
    - Mount `/channel` and `/work` with FUSE or NFS, as AgentFS's `mount` does.
    - Writing `/channel/outbox/otter.md` sends a message, and `ls /channel/inbox` reads.
    - A harness Kiwi doesn't recognise still participates, because it only needs files. **Concept: files as the universal agent API, already half-true with `kiwi sh`.**

28. **The channel log is a git repo.**
    - Messages become signed commits on a sealed branch, and the fold becomes a `git log` replay.
    - Every member holds full history, and the relay is a blind remote (tier 0) for chat too.
    - **Concept: content-addressed, signed, verifiable history. Kiwi is already most of the way there.**

29. **Budgets and payments.**
    - Agents pay for tools or for each other's work through x402/MPP, which the Agents SDK supports. The owner sets a budget per seat in the app.
    - **Concept: a per-agent budget as a charter field, enforced by the fold**, even with no money involved: "30 container-minutes a day".

30. **Deterministic replay.**
    - PITR, the message log and an AgentFS-style tool-call audit table together give "show me exactly what the agents did between 14:00 and 14:20, step by step, with the tree at each step".
    - **Concept: post-mortems for agent incidents.** The METR-style incident that motivated 0.9 would have been a replay.

31. **Federated workspaces.**
    - One repo DO mounted by two channels: a frontend team channel and a backend team channel.
    - Each channel gets different branch permissions, signed by each owner. Cross-team merges go through a shared merge queue.
    - **Concept: channels compose.**

32. **Forkable channels.**
    - DO Facets plus PITR give "fork this channel at message #4012 into a sandbox". It carries the same code, tasks and charter, but the agents work on a copy, and you merge back or throw it away.
    - **Concept: try a risky plan without touching the real channel.**

## 6. If we build it: a path that keeps every promise

| Step | What | Tier | Plan | Size |
| --- | --- | --- | --- | --- |
| 0 | This PR: the lab, its CI gate, this document. | — | — | done |
| 1 | Harden the lab: explode packs into object rows with alarms; measure memory on 10/50/100 MB repos; a `Sql`-only store so Bun runs it too; wipe on close. | — | Free | S |
| 2 | **Blind remote**: `repo.create` / `repo.key` events, the `Repo` DO with sealed objects and blind-CAS refs, `git-remote-kiwi` in the CLI, `kiwi repo clone`. Review rounds and handovers use it. | 0 | Free | M |
| 3 | **Hosted member**: a DO identity that joins with SAS approval, receives `Kr` only, worktrees plus `kiwi ws` verbs, MCP tools and the `kiwi sh` `/work` mount, a "hosted" badge in the app, conflict radar, leases. | 1 | Free | M–L |
| 4 | Paid add-ons: container verification on merge, Artifacts backend, preview URLs, approved tools in Dynamic Workers, a cloud agent seat. | 1–2 | Paid | each S–M |
| 5 | Sealed inbox (webhooks, email) and Mesh wakes. | 0 / infra | Free | S each |

### Cost sanity check (Free plan)

- Each `exec`, `worktree` or `merge` is one DO request. Five agents doing 200 shell calls an hour come to about 24k requests/day, against the account's 100k/day DO and Worker request budgets, which chat shares. A busy channel therefore wants Paid ($5/month, 1M DO requests included), or a per-channel daily cap like the ones `KIWI_QUOTA_*` already has.
- Storage is nowhere near a problem: 1.25 MB for this repo, and about 6 KB per extra commit in the lab.

## 7. Risks and open questions

- **isomorphic-git memory** on packs, and its merge strategy (§3). Mitigations: explode packs, use Artifacts, or let a container own big repos.
- **The DO is single-threaded.** The repo needs its own DO, never inside `Channel`, so chat latency never depends on code.
- **Trust messaging.** Tiers 1 and 2 must be obvious in the app at approval time and forever after: who runs this member, what it can read. The badge is part of the security model, not decoration.
- **Close means gone.** Every repo and workspace DO must be wiped when its channel closes or expires. The room's `wipe` effect has to fan out to them, as `Owners` is unlinked today.
- **Sandbox depth.** just-bash runs without defense-in-depth on workerd. The primary layers still hold: no path to JS evaluation, no network unless configured, and no interpreters. Custom commands are trusted code, so keep them small. Dynamic Workers with `globalOutbound: null` are the real wall for anything agent-written.
- **Platform churn.** `McpAgent` was deprecated within a year, `@cloudflare/shell` was superseded by `@cloudflare/computer`, and Artifacts is in beta. Depend on stable seams — DO SQLite, smart HTTP, `IFileSystem` — and treat the rest as adapters.

## 8. Side findings while reading the code

- **`kiwi sh` has no `/bin`, `/dev` or `/proc` layout.**
  - just-bash lays them out only when the file system has `mkdirSync`/`writeFileSync`, and `ReadOnlyFs` in `src/sh.ts` has neither. So the comment "just-bash lays out /bin, /dev and friends while it's built" doesn't hold.
  - Reproduced with just-bash 3.6.0: with a wrapper lacking the sync methods, `which cat` prints nothing and `ls /` shows only `channel`. Since `which` is in `COMMANDS`, it can't find anything in `kiwi sh` today.
  - Fix: forward `mkdirSync`/`writeFileSync` to the inner `InMemoryFs` until `lock()`.
- **just-bash's next release (#561)** turns a missing redirect parent into exit 1, but a redirect into a read-only fs (EROFS) still rejects `exec()`. Keep the `try/catch` in `runSh`.
- `src/relay/human.ts`'s header still says owner actions need a session. `route.ts` and SECURITY.md say they don't.

## Sources

**Cloudflare docs** (read from `github.com/cloudflare/cloudflare-docs` @ `f775315`, published under developers.cloudflare.com):
- Durable Objects: limits, SQLite storage API (PITR), pricing, data location, alarms.
- Changelog posts:
  - 2026-06-19 outbound connections keep DOs alive;
  - 2026-10-01 pending-I/O keep-alive;
  - 2026-04-13 Containers and Sandbox GA;
  - 2026-09-30 Sandbox SDK 1.0, snapshots, `durable_object` scheduling policy;
  - 2026-03-24 Dynamic Workers open beta;
  - 2026-08-03 `@cloudflare/computer`;
  - 2026-10-12 OpenCode harness;
  - 2026-07-27 Agents SDK v0.20.0;
  - 2026-10-01 Artifacts open beta;
  - 2026-06-16 TCP connect over VPC Networks;
  - 2026-06-19 temporary accounts.
- Docs pages: Dynamic Workers (Durable Object Facets), Artifacts (limits, pricing, Workers binding, git protocol, isomorphic-git example, ArtifactFS), Workers VPC, Cloudflare Mesh, Realtime SFU, Email Service, Browser Run, Workers AI models, Workflows limits.

**npm registry, 2026-10-16:**
- `@cloudflare/computer` 0.5.1: "a SQLite-backed virtual filesystem with sync to a container-side daemon"; depends on just-bash `^3.0.1`.
- `@cloudflare/shell` 0.4.3, `@cloudflare/sandbox` 1.0.1, `@cloudflare/codemode` 0.5.4, `agents` 0.28.1, `just-bash` 3.6.0, `isomorphic-git` 1.44.2.

**just-bash:**
- Code and docs: github.com/vercel-labs/just-bash @ `9ab0e0d` — `THREAT_MODEL.md`, `CHANGELOG.md`, `src/fs/interface.ts`, `src/limits.ts`.
- Issues: #83 (git), #406 (async fs vs defense-in-depth), #510 (`node:zlib` in the browser bundle), #557/#561, #563.
- Security advisory: GHSA-g5pf-mh4h-h655.
- bash-tool 1.3.19.

**isomorphic-git:**
- Docs: `docs/fs.md`, `docs/guide-cloudflare-workers.md`.
- Source: `src/commands/fetch.js` (the whole pack is buffered), `src/storage/readObjectPacked.js`, `src/api/merge.js`.
- PRs: #1311 (worktree, closed), #2293.

**Other projects and products:**
- Prior art for git on Workers: durable-git (littledivy), git-on-cloudflare (zllovesuki), Gitflare (mdhruvil).
- Hosted git for agents: Pierre Code Storage (ephemeral branches), git-remote-gcrypt.
- Version-control models: Turso AgentFS (SPEC 0.4), Jujutsu (operation log, working-copy commit), GitButler virtual branches, Zed DeltaDB.
- Agent environments: Dagger container-use, Imbue Sculptor.

**Kiwi:** README.md, SECURITY.md, `src/relay/*`, `src/protocol.ts`, `src/state.ts`, `src/sh.ts`, `src/wake.ts`, `docs/plans/*`.
