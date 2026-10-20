# Plan: Rex helpers (Settings → Install Rex Helpers)

Status: built, 2026-10-20. Items 1 and 2 landed in #554, items 3 to 6 in #557 (with #560), and
Settings → Install Rex Helpers in #563. Probes 1, 3, 4, 6 and 7 ran against
Rex `0.0.1792433367-g93d474` (API revision 4) and Claude Code 2.1.304 on jow's Mac; the results
are under "Probes before building", and what they changed in the build under "What the probes
changed". The plan below is kept as it was decided. Facts below were read from `main` at `9db1595e`
(kiwi 0.21.0), from Rex `0.0.1792158932-g88fd41` (the Rex Beta app 0.1.0 (1282), server build
1203) on jow's Mac, from Claude Code 2.1.304, from the Rex docs at
`https://www.superlogical.com/rex/docs/llms.txt`, and from probes run in a Rex pane.

## What this is

[Rex](https://www.superlogical.com/rex/docs/installation.md) is a terminal whose panes live in a
server you can script, like tmux, with a typed API, an event stream and a status protocol
(OSC 7501). A seat that runs in a Rex pane can get from Rex what #548 gets from tmux, and more:
it can show a person which seat needs them, from the tab itself.

The Rex helpers are Kiwi's side of that. They are switched on per computer from Settings, the
way `kiwi rotate on` is, off by default, and nothing of them is loaded while off. One part, the
status records, isn't Rex's alone: it goes to any terminal known to take OSC 7501 (decision 3).

## What we have to work with

**Rex, read from the CLI and API**

- Every Rex pane carries `TERM_PROGRAM=rex`, `REX_SERVER` (here
  `unix:///Users/jow/Library/Application%20Support/rex/server.sock`), `REX_SESSION`, `REX_BLOCK`
  and `REX_BIN_DIR`, and puts `rex` on the `PATH`. A harness started in the pane, and its tool
  processes, inherit them. Ids look like `block:01a15963-bacc-7426-91e9-4d98757dcd0c` and are
  never reused.
- `rex api list` / `describe` / `call` reach about 70 server methods, every one with a JSON
  Schema. A terminal pane adds its own (`com.superlogical.terminal.*`), called as
  `rex api call -s S com.superlogical.terminal.<m> '{"block_id": B, "args": {…}}'`:
  - `format`: the screen as `text`, `html` or `vt`, with `trim`, `unwrap` and `extra_cursor`;
  - `write`: bytes into the pty as if typed;
  - `process`: the pane's child, its foreground process (`pid`, `name`, `path`, `cwd`) and its
    ancestors;
  - `program_status`: every OSC 7501 record the pane holds;
  - `pwd`, `title`, `size`, `tty_mode`.
- `rex send -b B TEXT` and `rex send-key -b B enter` type into a pane; `rex capture -b B` reads
  it.
- `rex events -s S --json` (or `--all`) streams JSON lines, among them
  `program_status_changed {id, record, reason}`, `program_status_removed {ids, reason}`,
  `process_changed {generation, foreground}`, `child_exited`, `title_changed`, `block_closed` and
  `session_destroyed`.
- The app takes actions through `client.perform` / `rex do`, among them `session.select
  {session_id, window_id?}`. These need Remote Control on in Rex's settings.
- Rex's config is Lua, at `$XDG_CONFIG_HOME/rex/init.lua`, else `~/.config/rex/init.lua`, or
  `REX_CONFIG`. `rex.action{…}` adds a command-palette action; `rex config check` and
  `rex config reload` apply it.
- Exit codes: 0 ok, 3 target not found or ambiguous, 4 server unreachable.
- The [Program Status Protocol](https://www.superlogical.com/rex/docs/build/program-status.md),
  revision 0.4: `ESC ] 7501 ; key=value:… ESC \`, states `idle`, `working`, `done`, `blocked`
  (`kind` `permission`, `question` or `auth`), `error`, `clear`; `msg` and `title` are base64;
  `id` is a path, so `kiwi/ch` is a child of `kiwi`; each report replaces its record whole;
  `working` and `blocked` records are dropped when the pane's process exits.

**Probed 2026-10-20, Claude Code 2.1.304 in a Rex pane**

- Claude Code sends 7501 itself. Its root record is `working` with `msg` the running tool's
  description; each subagent gets a child record (`id` the agent id, `title` its task), cleared
  when it ends. At every turn end the root goes `done` with no `msg`, and back to `working` on the
  next turn. Across three turn ends it sent no `idle` and no clear of every record.
- Another process can add records to the pane. A tool process (stdout captured, no controlling
  terminal, `/dev/tty` not openable) wrote to the seat's terminal device, found with
  `ps -o tty= -p <claude pid>` (`/dev/ttys001`). `id=kiwi/probe` showed in `program_status`,
  fired `program_status_changed`, survived Claude Code's own reports and three turn ends, and
  `state=clear:id=kiwi` removed it and everything under it.
- Rex credits a record to the pane's foreground process (`owner: {pid: 22303, name: "claude"}`),
  not to whoever wrote it. `app=kiwi` is what marks ours.
- Two Claude Code panes in one Rex session kept separate records, per pane.
- A block that is detached (in no layout, seen by no client) takes `write`. Into a `cat` started by
  `session.new_block`: `/clear` sat on the line without Enter, six `\x7f` erased it, and `\r`
  submitted the next line. `rex send` adds no newline.
- Rex has no last-key time for a client: `client.list` and `session.list_clients` carry
  `connected_at` and `connection_state` only. Nothing stands in for tmux's `#{client_activity}`.
- `~/.claude/sessions/<pid>.json` has no Rex field (it records `tmux` only inside tmux).
- tmux drops OSC sequences it doesn't know. Passthrough (`allow-passthrough on`, `ESC P tmux;`)
  hands them to the outer terminal, which files them under the pane tmux runs in, not the tmux
  pane. A seat in tmux inside Rex can't have records of its own.

**Kiwi today**

- Rotation finds its pane in the Stop hook from `TMUX` and `TMUX_PANE` (`paneOf`,
  `src/hooks/rotate.ts`), and `kiwi rotate send` drives tmux from `src/rotate/pane.ts`:
  `display-message` for the pane's identity, `ps` for the foreground group, `list-clients
  #{client_activity}`, `capture-pane -p -e` for the input box, `send-keys` to type.
- A seat's record (`SeatRecord`, `src/config/file.ts`) holds harness, session, pid and model, and
  no terminal.
- The daemon polls each seat's harness files every 3 s for its activity (`harnessActivity`,
  `src/harness.ts`).
- Settings sections that act on this computer show only when the desktop bridge has their method
  (`VoiceFields`, `GithubFields` in `web/src/components/settings.tsx`; `KiwiBridge` in
  `desktop/src/bridge.ts`). The app runs its bundled `kiwi` for the CLI and the daemon
  (`desktop/src/cli.ts`, `desktop/src/daemon-client.ts`).

## Principle

**Rex is a place a seat may run, never a requirement.** Everything works without it, a seat in
tmux keeps tmux, and with the helpers off nothing of them is loaded. Read state from Rex instead
of guessing it, write to a terminal only counts, names and task numbers, never message text, and
remove everything Kiwi wrote when switched off.

## The plan

### 1. Where a seat runs

Every hook that records the seat also reads `REX_SERVER`, `REX_SESSION` and `REX_BLOCK` from its
environment, beside `paneOf`. It records them on the seat as `rex: {server, session, block}` only
when all of these hold:

- `TERM_PROGRAM` is `rex`;
- `TMUX` is unset (in tmux inside Rex the variables name the pane tmux runs in, not the seat's);
- the ids match `^session:[0-9a-f-]{36}$` and `^block:[0-9a-f-]{36}$`.

The location stays on this computer: the server is a local socket and the ids mean nothing on
another machine, so it never goes to the relay. The terminal device is not stored; it is read from
the seat's pid each time it's needed, since a device is reused once its pane closes.

Every seat, in Rex or not, also records `TERM_PROGRAM` and `TERM_PROGRAM_VERSION` from the same
environment, outside tmux only. Item 2 reads them to tell whether the seat's terminal takes 7501.

### 2. Status records: the seat's tab shows a person is needed

The daemon writes two kinds of record into the pane of a seat on this computer (decision 2):

| When | Record | Cleared when |
| --- | --- | --- |
| The seat has a question open to a person (`kiwi ask-human`, a decision in Needs you) | `id=kiwi/<channel>/ask`, `state=blocked:kind=question`, `msg` "2 questions for a person in channels-explore" | the last one is answered or withdrawn |
| A task the seat owns waits for review | `id=kiwi/<channel>/T7`, `state=done`, `msg` "T7 waits for review" | the round closes, or the task leaves review |

Both carry `app=kiwi` and `title` "Kiwi". For example:

```
ESC ] 7501 ; state=blocked:kind=question:app=kiwi:id=kiwi/channels-explore/ask:title=S2l3aQ==:msg=<base64> ESC \
```

Rex marks the seat's tab and its session in the picker, and Lua scripts hear it. Rex plans
mobile push from the same records. A `done` record survives the harness exiting and the next
shell prompt, as 7501 means it to: the result is there to look at until someone does.

- **Who writes.** The daemon, because it sees a question answered while the agent sleeps and
  knows every seat on this computer. A hook can write too (the probe was a tool process), and
  the Stop hook may rewrite the record on the way out, but the daemon owns it.
- **What it says.** A count, the channel's name and a task's number, nothing else. Never message
  text, a task's title or a person's name.
- **`id`.** `kiwi/<channel alias>/ask` and `kiwi/<channel alias>/T<n>`, the alias cut to the 7501
  segment set (`[A-Za-z0-9_.+-]{1,32}`). Clearing `kiwi/<channel>` clears one channel's, clearing
  `kiwi` all of Kiwi's.
- **Which terminals (decision 3).** Any terminal known to take 7501, read from the
  `TERM_PROGRAM` and `TERM_PROGRAM_VERSION` item 1 records: Rex today, Ghostty from the release
  that ships its 7501 support, others as they ship it. The list lives in Kiwi, beside the code
  that writes. A terminal not on it gets nothing, though 7501 says terminals must ignore what they
  don't know: one that doesn't would print the sequence into the agent's screen. A seat in tmux
  gets nothing either, since tmux drops it. Kiwi can't ask the terminal: the `OSC 7501 ; ?` reply
  goes to the harness's input, not to Kiwi.
- **Before every write**, all of these must hold, else the write waits for the next change:
  - the seat's pid is alive and leads its terminal's foreground group (the check
    `holdsInput` already makes); in Rex, `process` for the recorded block also names it as
    `foreground`;
  - the pid's terminal device (`ps -o tty=`) exists and belongs to this user;
  - the harness isn't drawing: in Rex, the block's root record is `done` or `idle`; elsewhere,
    the seat's activity is idle (for Claude Code, its registry says `idle`). A seat that stays
    busy gets the record at its next turn end.
- **How.** One `write()` of the whole sequence, under 4096 bytes, ended with `ESC \`. At most one
  write per seat per second, and only on a change.
- **Lifetime.** The terminal drops `blocked` records when the pane's process exits; the daemon
  writes again when the seat comes back (a new pid in its record). The daemon clears a `done`
  record when the review ends, through the same checks. One left behind by a harness that has
  exited stays until the terminal stops showing it, since there is no live pid to find the pane
  by. Switching the helpers off clears `kiwi` in every pane it still can.

### 3. Seat state from Rex

With the helpers on and a seat in Rex, the daemon runs one `rex events --all --json` per Rex
server (restarted with backoff, stopped when no seat is in Rex) and keeps the newest root record
and foreground process per recorded block.

- A harness file reader stays first where Kiwi has one: Claude Code's registry and transcript carry
  the session id, model and context, which a 7501 record doesn't.
- Rex fills `state` where the reader can only guess (Grok's "idle after 60 s", or a harness Kiwi
  has no reader for) once that harness sends 7501: `working` → working with `msg` as the tool,
  `done` or `idle` → idle, `blocked` → waiting.
- `child_exited` and `process_changed` say at once that a seat's harness left its pane, where
  today the pid check catches it within the 3 s poll.

For Claude Code this adds speed, not information, so it comes after items 2 and 4.

### 4. Rotation in a Rex pane

`kiwi rotate send` gets a Rex backend. `src/rotate/pane.ts` splits into the sender (shared: the
guard rounds, the confirm-before-Enter act, the lock, the switch, `rotate.log`) and two backends:

```ts
interface PaneBackend {
  identity(): PaneId | null;        // the pane is still the one the hook gave
  holdsInput(pid: number): boolean; // the target leads the pane's foreground
  capture(): string | null;         // the screen with SGR, for inputText
  lastKeyMs(): number | null;       // ms since a person pressed a key, null when unknown
  type(text: string): boolean;
  enter(): boolean;
  erase(n: number): boolean;
}
```

| What the sender needs (#548) | tmux | Rex |
| --- | --- | --- |
| Where the pane is | `TMUX`, `TMUX_PANE` | `REX_SERVER`, `REX_SESSION`, `REX_BLOCK` (item 1) |
| The pane is still the one it was given | `display-message '#{pid} #{pane_pid} #{pane_tty}'` | the server's `instance_id` (`server.status`), the block still in `session.list_blocks`, and its `process.child.pid` unchanged |
| The target holds the input | `ps -o tty,tpgid,pgid` | `process.foreground.pid` equals the target, and `ps` as today |
| The input box | `capture-pane -p -e` | `format {format: "vt"}` (probe 3) |
| No one pressed a key in 10 s | `list-clients #{client_activity}` | no signal: two reads at least 10 s apart where `inputText` is `""`, and the root record stayed `done` or `idle` in between |
| Type, Enter, erase | `send-keys -l /clear`, `Enter`, `-N 6 BSpace` | `write` with literal bytes, so the sender controls each one: `/clear`, then `\r`, or six `\x7f` to erase; `rex send-key enter` only if probe 4 shows Claude Code wants another Enter |
| Reaching the server | `tmux -S <socket>` from the hook's `TMUX` | `rex -S <REX_SERVER>`, with the binary from `REX_BIN_DIR`, both passed to the detached sender as arguments |
| The session is idle and the same | `~/.claude/sessions/<pid>.json` every 2 s | the same file stays the truth (it has the session id); a root `done` from Rex events starts a round early instead of waiting for the next 2 s |
| Server gone | `tmux` fails → `no-tmux` | exit 4 → `no-pane`; exit 3 → `not-its-pane` |

These are unchanged and shared, for both backends:

- `/clear` is confirmed in the box before Enter, else erased only while the session, pane and
  foreground are still the target's;
- ownership is rechecked every round, and again right before Enter and before erasing;
- one sender per session (the lock);
- the switch is rechecked every round and before Enter.

The two reads prove less than `#{client_activity}`: someone who typed and erased within the 10 s
isn't seen. The confirm step still catches a draft that is there when `/clear` is typed, and the
residual stays the same in both: a key pressed in the milliseconds before Enter lands on the line.
The whole screen isn't compared, because Claude Code's footer and status line redraw while idle.
Rex's version is slower to start, since it waits two reads apart where tmux reads one timestamp.
A per-pane last-input time in Rex would close that gap; ask Superlogical for it.

- `paneOf` returns tmux when `TMUX` is set, else the Rex location, else nothing (no rotation).
- `kiwi rotate send` runs detached with a short argv and without the pane's `PATH`, so it gets the
  backend, the server address and the `rex` binary as arguments, the way #548 passes the socket.
- `rotate.log` names the backend on every line.
- Typing reaches a block no client is viewing (probed above), so rotation never focuses or
  selects anything.
- Item 2 doesn't get in the way. Rotation waits while a question to a person is open, which is
  when item 2's `blocked` record is up; if probe 1 shows `/clear` removes Kiwi's records, the
  daemon's rewrite after SessionStart (`clear`) puts them back.
- The Rex backend is imported only by `kiwi rotate send`, only when rotation is on and the seat has
  a Rex location.

### 5. From Needs you to the seat

A Needs you item from a seat on this computer with a Rex location gets **Show in Rex**. The bridge
(`rexShow`) runs `session.focus_block` for the block, then `client.perform` `session.select` on
this computer's Rex app (the client with `info.kind` `app` in `client.list`). Without Remote
Control the second call is refused; the item then says so once, with where to turn it on. Seats on
other computers don't get the button.

### 6. A palette action in Rex (first release, decision 4)

`~/.config/rex/kiwi.lua` defines `kiwi_needs_you` ("Kiwi: Go to the seat that needs me"): it walks
`session.list` and each block's `program_status` for `app=kiwi` records and selects the oldest
`blocked` one, else the oldest `done`. It is loaded by one line in `init.lua` that names Kiwi in a comment, so removing it
takes only what Kiwi wrote, as `rex skill remove` does (probe 6).

As built: an action in `init.lua` can't reach another session (every call there answers "stream
is not attached", and `rex.session.attach` exists only in scripts). So `kiwi.lua` holds only the
action, which runs `kiwi-find.lua` beside it with `rex do`. The finder attaches to each session,
picks the block by its records' `updated_at`, and focuses it; the action then queues
`session.select` on the client that ran it, so the app switches sessions without Remote Control.

## Settings → Install Rex Helpers

A section in Settings, desktop only, shown when the bridge has `rexStatus` and Rex is on this
computer:

> **Rex**
> Kiwi marks a seat that needs you, or has work for you to look at, in Rex's tabs (and in other
> terminals that support it), opens it from Needs you, and lets rotation work in Rex panes. Stays
> on this computer.
> [Install Rex Helpers] / Installed · [Remove]

- **Bridge.** `rexStatus(): Promise<RexStatus>`, `rexInstall()`, `rexRemove()`, `rexShow(seat)`.
  `RexStatus` is `{found, version?, server: "running" | "stopped", helpers: "on" | "off",
  rotation: "on" | "off", remoteControl?: boolean}`. Main runs the bundled `kiwi rex on|off|status
  --json`.
- **CLI.** `kiwi rex on|off|status`, for Linux servers and people without the app, like
  `kiwi rotate`. `on` writes `rex: "on"` to this computer's Kiwi config and installs the palette
  action (item 6); `off` clears `kiwi` in every pane it still can, stops the events process and
  removes what it wrote. The same switch covers status records in the other terminals that take
  7501 (decisions 1 and 3).
- **Finding Rex.** `rex` on the `PATH`, else the newest
  `~/Library/Application Support/com.superlogical.rex/RexServer/Versions/*/Rex Server.app/Contents/MacOS/rex`
  on a Mac. The server is running when `rex --autostart=false whoami` exits 0. Kiwi never starts a
  Rex server.
- **Rotation stays its own switch (decision 1).** With both on, seats in Rex rotate. If tmux gets
  its own Settings entry, or a second terminal takes the status records, the section's heading
  becomes "Terminals", each part with its own switch.
- **Not installed:** `rex skill setup`. It is Rex's agent skill and adds a SessionStart hook to the
  same `~/.claude/settings.json` Kiwi's hooks live in; a person runs it if they want it.

## Not doing

- Starting seats in Rex, or waking through it. The daemon never starts a harness process, and
  wakes stay on hooks, listeners and the harnesses' own commands (decided for tmux; the same
  here).
- Sending what's on a seat's screen anywhere. The input box is read only to guard `/clear`, as
  with tmux.
- Remote Rex servers (`rex -S`, Rex's built-in Tailscale). This computer's seats only.

## Risks

- **Writing into a pane the harness is drawing in.** Kiwi's bytes could land between two writes of
  one of the harness's escape sequences and garble a frame. Writing only when the root record is
  `done` or `idle`, in one `write()`, keeps it rare; probe 5 measures it.
- **A wrong pane.** A terminal device is reused once its pane closes. The device comes from the
  live pid every time, and Rex's `process` must name the same pid, before any write.
- **Rex is beta.** Method and event names can change. `kiwi rex on` and the daemon check the
  methods they use with `rex api describe`; on `method_not_found` that part turns itself off and
  says so in `kiwi rex status`.
- **The record names the harness.** Rex shows the foreground process as its owner. `app=kiwi`
  and `title` "Kiwi" say whose it is.

## Probes before building

Run on 2026-10-20 against Rex `0.0.1792433367-g93d474` and Claude Code 2.1.304, in detached
blocks and a throwaway Rex server with its own config, all removed afterwards.

1. **`/clear` keeps Kiwi's records.** A `kiwi/probe/ask` record written into an idle Claude Code's
   terminal was still there after rotation typed `/clear` and Enter, and Claude Code's root
   record stayed `idle`. Nothing needs rewriting after SessionStart.
2. Not run: it needs a model turn that asks for permission.
3. **`format {format: "vt"}` reads as the tmux capture does.** Lines end in CRLF, every style
   starts with a reset, and the dim placeholder comes out as `\x1b[2m…\x1b[0m`. `inputText` reads
   Claude Code's box with its placeholder as empty, and a draft as the draft.
4. **Enter is `\r`.** Claude Code turns on kitty keyboard flags 5 (disambiguate, report alternate
   keys), which keep Enter and Backspace in their legacy bytes. `rex send-key enter` sends `\r`,
   `backspace` sends `\x7f`, several keys go in one call, and Enter submitted `/clear` for real.
5. Not run: it needs a streaming turn to watch for garbled frames.
6. **`require("kiwi")` finds `kiwi.lua` beside `init.lua`,** checked with `rex config check` on a
   copy. Rex's check also caught that `keywords` must be a string.
7. **The hooks get Rex's variables.** Claude Code's own process carries `TERM_PROGRAM`,
   `REX_SERVER`, `REX_SESSION`, `REX_BLOCK` and `REX_BIN_DIR`, and its hooks inherit its
   environment.
8. Ghostty: still waiting on its 7501 release.

### What the probes changed

- **Rotation in Rex works end to end.** Against an idle Claude Code in a Rex block, `kiwi rotate
  send`'s Rex backend waited for two empty reads 10 s apart, typed `/clear`, saw it in the box,
  pressed Enter, and the session id changed, in 11.5 s. With a draft in the box it typed nothing
  and timed out.
- **The event stream's shape:** `{type: "session_event", payload: {session_id, event: {type:
  "block_event", payload: {block_id, name, payload}}}}`, with `child_exited` and
  `process_changed` as block events and `block_closed` as a session event. `--all` carries block
  events too, and a lot of `client_joined` lines, one per `rex` call.
- **The API's shapes:** `program_status` gives `{records: [...]}`, the root record without `id`
  and `msg` already decoded; `process` gives `{child: {pid}, foreground: {pid, name, …}}`;
  `server.status` has `instance_id`; `session.list_blocks` has `placement`.
- **Show in Rex:** `session.focus_block` works without Remote Control. `rex do session.select`
  reaches the app and, with Remote Control off, exits 1 with "Rex.app is not accepting
  actions". With no app client connected, Needs you now says to open the app.
- **`rex --version` is not a flag;** `rex version` prints `rex <version>`.

## Decisions for the owner

All taken by the owner, 2026-10-20:

1. How it's switched on: one switch for every Rex helper; rotation keeps its own.
2. What Kiwi marks: a question open to a person (`blocked`), and also a seat's task waiting for
   review (`done`).
3. Where: any terminal known to take 7501, not Rex only.
4. The palette action (item 6): in the first release.

## Order of work

One issue and one PR each, with its CI gate:

1. Probes 1 to 8, results into this plan: done here, except 2, 5 and 8.
2. Where a seat runs (item 1), `kiwi rex on|off|status`, and the status records (item 2), in Rex
   and in the terminals on the list: #554.
3. Settings → Install Rex Helpers, the bridge, and the palette action (item 6): the palette in
   #557 (#560), Settings in #563.
4. The sender split and the Rex backend for rotation (item 4), reviewed against #548's guard: #557.
5. Show in Rex from Needs you (item 5): #557 (#560).
6. Seat state from Rex events (item 3): #557.
