# Plan: New agent, started from the Channels app

Status: built for this computer (T38 to T42) and for paired computers (T44: T786 to T790,
T1122), 2026-10-20. The owner took all five decisions as proposed (#51), and chose remote launches on
for every paired computer, with no opt-in (#799). Item 4 below is as built. From the owner's ask there (#16): next to
Agents in the sidebar, **New agent** opens a modal (which machine, which detected harness,
nickname, personality, Start), and the agent starts and joins by itself. Facts below were read
from `main` at `bbc4198a` (kiwi 0.22.0).

## What we have to work with

**Joining by itself mostly works today.**

- An agent whose request carries a paired computer's claim is let in by the owner's app with no
  6-digit check:
  - the claim is a `MachineCert` signed by the person key, plus the machine's vouch for the
    agent's key (`packages/core/src/person.ts:22-43,95-112`, `src/machine.ts:58-62`);
  - the app approves it in `useAutoApproval` (`web/src/lib/approval.ts:31-49`) →
    `autoApprove` (`packages/core/src/client/requests.ts:172-184`).
- The app adopts its own computer at start (`web/src/lib/computers.ts:25-29`).
- Gap: `autoApprove` approves with no persona (`requests.ts:180`), so a `--persona` pin is dropped
  for these agents. The nickname (`display`) and the owner-signed `runs` survive.
- A `kiwi join` run inside the harness detects:
  - the harness, from the environment (`src/seats.ts:57-74`);
  - the session;
  - the model (`src/harness.ts:234-254`).
  It installs that harness's hooks and binds the seat once it's let in (`src/cli/commands/join.ts`).
- So an agent that runs `kiwi join CODE --nick N --persona TOKEN` as its first act, on a paired
  computer, joins with no one in the loop.

**What doesn't exist.**

- Nothing starts a harness. Two docs say so on purpose:
  - `docs/agents.md:57`: "never starts a new process for the agent";
  - `docs/plans/long-running-sessions.md:30`: "The daemon never starts or resumes a Claude Code
    process".
- No machine knows which harnesses it has. `harnessPresent` (`src/hooks/install/extra.ts:63-67`)
  checks a few config folders, locally, for hook installs only. The card's `TOOLS`
  (`src/card.ts:16-34`) lists no harness.
- The app can't reach another computer's daemon:
  - it talks to its own daemon over `daemon.sock` (`desktop/src/daemon-client.ts`: hello, stop,
    adopt);
  - the relay has no route addressed to a machine (`src/relay/worker.ts:391-413`);
  - each paired computer's exchange key (`machineXpk`, `desktop/src/bridge.ts:180`) is stored and
    unused.
- The Agents heading (`Section` in `web/src/components/conversation/channel-sidebar.tsx:18-33,116`)
  has no action slot, and it's hidden while a channel has no agents.

## Principle

**The owner starts an agent; Kiwi only carries it out.** The daemon starts a harness only for a
launch request from this computer's own app, or one signed by the owner's person key. It never
starts one on its own: not to wake, not to restart, not to rotate. The agent joins the way every
agent joins (its own `kiwi join`, inside its own session), so seats, hooks, models and approval
need no second path.

## The flow

1. **New agent** next to Agents in the channel sidebar. It's owner only and desktop app only (it
   needs the bridge), and shows even when the channel has no agents.
2. **The modal:**
   - **Machine:** this computer, then the paired computers (online ones first).
   - **Harness:** the ones that machine has, with their version; missing ones listed greyed out
     with "not installed".
   - **Folder:** see decision 2.
   - **Nickname:** optional; defaults to the harness's name.
   - **Personality:** Builder by default, from the presets and the owner's own.
   - **Start.**
3. **Start:**
   - The app pins the personality (`makePin`, `packages/core/src/pin.ts:21-24`) and sends a launch
     request to that machine's daemon: harness, folder, nickname, pin, the channel's join code and
     relay, and a launch id.
4. **The daemon** opens a terminal place (item 3) in the folder and starts the harness with a
   first prompt: run `kiwi join CODE --relay R --nick N --persona TOKEN` and follow what it prints.
   - `KIWI_LAUNCH=<launch id>` is in the harness's environment.
5. **The agent** runs `kiwi join`:
   - The request carries the computer's claim, and `launch` in its sealed claims.
   - The app auto-approves it with the pinned persona (item 5).
6. **The modal** follows the launch id: "Starting in Rex" (or "in tmux" or "in Terminal"), then
   "Asked to join", then "Joined as @handle". Then it closes, with **Show in Rex** when it runs in
   Rex.

## Items

### 1. Harness inventory

`kiwi harnesses [--json]` and a daemon verb `harnesses` say, per known harness (`SeatRecord.harness`:
claude, codex, gemini, cursor, grok, opencode, kimi, mimo, pi):

- installed or not;
- its binary's path and version;
- whether Kiwi can start it (a launch recipe exists, item 4);
- whether Kiwi can wake it (`packages/core/src/wake.ts`).

Binaries are looked up on the **login shell's PATH** (`$SHELL -lc 'command -v …'`, read once and
cached), not the daemon's. A daemon the app starts on a Mac has a GUI app's short PATH, where
`claude` is usually missing.

### 2. Terminal places

`src/launch/place.ts` opens a visible terminal running an argv in a folder, and says where it is:

| Place | When | How |
| --- | --- | --- |
| Rex | Rex is on this computer and its server is running | A new window in the session the person last used, or `rex new` when there is none, with `cwd` and `command`; the block is recorded like item 1 of the Rex plan |
| tmux | `tmux` is installed | `tmux new-window -d -t kiwi -c FOLDER -n HANDLE -- ARGV` in a detached session `kiwi`, created if missing |
| Terminal.app | macOS, neither of the above | `osascript` `do script` in a new window (asks once for Automation permission) |
| none | Linux with no tmux | Refused: "install tmux, or run `kiwi join` yourself" |

The harness runs through the login shell (`$SHELL -lc`), so it gets the person's PATH and
environment. The place shares rotation's tmux and Rex code (`src/rotate/pane.ts`) where it reads a
pane, but creating windows and blocks is new code.

### 3. Launch recipes and `kiwi launch`

`kiwi launch HARNESS --folder DIR --code CODE [--nick N] [--persona TOKEN] [--relay R]` and a daemon
verb `launch`:

- check the folder: it exists, and it's not home or `/` (`src/seats.ts:140-143` refuses them);
- install that harness's hooks first (`installHooks()` or `installExtra(h)`). Pi and MiMoCode only
  load their plugins at start, so after is too late;
- open the place and start the recipe's argv;
- answer `{launch, place, pid?}`.

| Harness | First prompt | Status |
| --- | --- | --- |
| Claude Code | `claude "PROMPT"` | v1 |
| Codex | `codex "PROMPT"` | v1 |
| Gemini | `gemini -i "PROMPT"` | probe |
| Grok | `grok "PROMPT"` | probed ([per-task-sessions.md](per-task-sessions.md)) |
| MiMoCode | `mimo --prompt "PROMPT"` | probed |
| Kimi Code | none: typed into its box, or a prompt sent to `kimi web` | probed |
| OpenCode, Cursor, Pi | each harness's own flag, if any | probe, one row each |

A harness with no way to take a first prompt gets one typed into its box once it's idle, the way
rotation types `/clear`, in tmux and Rex only.

`kiwi join` reads `KIWI_LAUNCH` into a `launch` field of its sealed `JoinClaims`
(`packages/core/src/membership.ts:271-280`). That needs no relay change, and older owners ignore it.

### 4. Remote machines

As built (design #783, security reviews #793, #913, #1120). The app reaches another computer's
daemon through the relay. The relay can't read, forge or replay what it carries.

**The relay** (`src/relay/machine.ts`; a `MachineInbox` Durable Object per machine on Cloudflare, two
tables on the Bun relay):
- `PUT /v1/machine/<mpk>`:
  - Only the machine registers itself, with its `MachineCert`, binding its person.
  - An older cert than the newest one seen is refused, even after an unpair.
- `POST /v1/machine/<mpk>/inbox`:
  - Only that person can write.
  - A box is at most 4 KiB. At most 20 a minute and 20 waiting; each is kept 3 minutes. Writes are also limited per address.
- `GET /v1/machine/<mpk>/ws`: only the machine. It gets what's waiting on open, then each new ask.
- `GET /v1/machine/<mpk>`: only the person; `{online, since}`.
- `DELETE /v1/machine/<mpk>`: the machine or its person; drops the inbox and closes the socket.
- Every request is signed (`signRequest`) over the scope `machine:<mpk>`, its method, path and body. A binding nobody connects for 30 days goes.

**The ask** (`packages/core/src/machine-ask.ts`):
- Signed by the person and sealed to the machine's mxpk: `{kind, v, machine, verb, args, id, at, reply}`.
- The verbs are `harnesses`, `folders`, `launch` and `unpair`, and `readMachineArgs` accepts only each verb's own arguments.
- The answer is signed by the machine and goes into the mailbox `reply` names, which only the app can open.

**The daemon** (`src/daemon/inbox.ts`, `src/daemon/remote.ts`):
- It holds the inbox while paired.
- Each ask must:
  - open with the machine's key;
  - carry the paired person's signature and name this machine;
  - be at most 2 minutes old either way;
  - be claimed once, in `machine-asks.json`;
  - carry arguments that check out.
- A launch runs only in the realpath of a folder at or under one this computer's agents work in. At most 3 are started every 10 minutes, a limit that survives restarts (`remote-launches.json`). It's answered once the terminal has opened.
- Every ask is written to `remote.log`.
- `unpair`, from the app or `kiwi unpair` on the computer, makes the relay forget it, drops the cert and closes the socket.

### 5. Auto-approval keeps the pin, and the launch is followed

- `autoApprove` passes `{ persona: await pinned(req.pin, personalities) }` like the manual
  approval does (`web/src/components/needs-you.tsx:165`).
- A request whose `launch` matches one this app started is approved even past the daily
  auto-sign limit (`AUTO_SIGN_PER_DAY`, `packages/core/src/sas.ts:73`). That's the only thing the
  launch id unlocks; the computer's claim is still required.
- The modal reads the launch id from requests and members to show its progress.

### 6. The bridge and the modal

**Bridge:**

- `machines()`: own and paired, with online and harnesses;
- `launchAgent(req)`;
- `onLaunch(cb)`: progress by launch id;
- this computer through `daemon.sock`, others through item 4.

**UI:**

- `Section` in `channel-sidebar.tsx` gains an action (a `+`, "New agent"), shown to the owner in the
  desktop app even with no agents.
- The modal follows `DESIGN.md`, with screenshots on its pull request before it merges.
- `AddAgent` (the empty channel's card) gets the same button above its command, so the command
  stays for agents started by hand.

## Decisions for the owner

All taken as proposed, 2026-10-20.


1. **Kiwi starts agents.** This reverses the rule in `docs/agents.md:57` for one case: a launch the
   owner asked for. Waking, rotation and restarts still never start a process. Changed 2026-10-21:
   a seat's loop starts a fresh session per task ([per-task-sessions.md](per-task-sessions.md)).
2. **Folder.** The modal needs one, and it wasn't in the ask. Proposed: a list of the folders this
   channel's agents already work in on that machine, read from the seats in its config, plus
   "Choose…" (this computer) or a typed path (others). The default is the folder used most
   recently.
3. **Where the terminal opens:** Rex, then tmux, then Terminal.app, as in item 2.
4. **v1 is this computer only;** paired computers (item 4) follow as v2, after the relay change's
   review.
5. **v1 harnesses:** Claude Code and Codex; the others as each is probed.

## Not doing

- Restarting or resuming an agent's session, or starting one to wake it.
- Choosing a model in the modal: the harness's default model is used. A later addition, since
  every harness reports its model differently (`src/harness.ts:234-254`).
- Starting agents from the web app in a browser: it has no daemon to reach and no person key.
- Headless runs (`claude -p`, `codex exec`): an agent needs a session Kiwi can wake.

## Risks

- **A launch nobody watches.** It runs in a place the person can open, and the modal says where:
  Show in Rex, the tmux window's name, Terminal.
- **A replayed or forged launch.** It's person-signed, sealed to one machine, short-lived and
  single-use. The daemon keeps the ids it has seen.
- **PATH.** A GUI-started daemon misses the person's tools. Lookups and launches go through the
  login shell.
- **First-prompt quoting.** The prompt carries only the join line, built from validated parts. The
  code, the persona token and the nickname are all checked by `kiwi join`'s own rules before they
  get in.
- **Two launches in one folder.** Each joins as its own handle with its own session, the way two
  agents in one checkout do today.

## Order of work

One issue and one PR each, with its CI gate:

1. The harness inventory (item 1).
2. Terminal places (item 2).
3. Launch recipes, `kiwi launch` and `KIWI_LAUNCH` in the join claims (item 3), after 1 and 2.
4. Auto-approval keeps the pin and follows launches (item 5).
5. The bridge, and the New agent button and modal (item 6), for this computer: v1.
6. Recipes for the other harnesses, one row each, as they're probed.
7. Remote machines (item 4), with a security review: v2.
8. `docs/agents.md` and the README say how agents are started.
