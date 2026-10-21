# Plan: one fresh agent session per task

Status: proposal, 2026-10-21. Decided by the owner: a task's session ends when the task is done.
Open: whether to adopt it (decision 1) and what happens to rotation (decision 2). Facts below come
from spikes on a laptop against a local relay, at `main` `b3985031` (kiwi 0.22.0), with each
harness in its own tmux window and a throwaway `HOME`.

## Why

[long-running-sessions.md](long-running-sessions.md) measured seats that stay in one harness session
for days: Claude seats peaked between 638k and 967k tokens, and one spent 1,527 of its 1,953 turns
above 200k. Rotation clears a seat at a boundary by typing into its pane, and it needs a guard per
harness: the input box read from the screen, the pane's foreground, a key pressed in the last 10
seconds and, for Codex, a handoff that guesses which new thread is the seat's. It is built for
Claude Code and Codex only.

The same plan's principle already holds the answer: **a session is disposable; the seat and the
channel hold the state.** Re-entry (`packages/core/src/reentry.ts`) puts a fresh session back on its
task. So start each piece of work in a fresh session, and end that session when the work is done.
Nothing is typed into a session that is working, and every task starts small.

## The shape

- **The owner makes the windows.** One tmux window per agent, each with its harness, model and
  effort chosen by the owner. The owner sees each harness's one-time dialogs the first time.
- **A loop in each window** waits for the seat's next piece of work, starts a fresh harness session
  with a first prompt, and ends it when that work is done.
- **The lead stays long-running.** Its context is held by auto-compaction, like every Claude
  session's: `CLAUDE_CODE_AUTO_COMPACT_WINDOW=300000` in the shell profile where the seats run
  (owner, 2026-10-21; set on opus-vm). The variable takes precedence over the folder's
  `autoCompactWindow` (400k, decided 2026-10-19).
- **Reviews** get a fresh reviewer session per round. The owner proposed a reviewer's new subagent;
  a fresh session gives the same clean context and works in every harness. Not spiked.

## What the spikes found

| Harness | Version, model | First prompt | Ends cleanly on | Fresh session takes the seat | Idle session woken |
| --- | --- | --- | --- | --- | --- |
| Claude Code | 2.1.304 | `claude "PROMPT"` | SIGTERM (143) | yes, at its first hook | yes, its listener hook |
| Codex | 0.163.0, gpt-6-astra | `codex "PROMPT"` | SIGTERM (143) | no: the seat stays on the old thread, and `codex queue` wakes go there | yes, once the seat names the new thread |
| Grok | 1.0.62, grok-4.7 | `grok "PROMPT"` | SIGTERM (0) | no: "fond-owl works from this folder in another session" | only while the session runs a `kiwi listen` monitor |
| MiMoCode | 0.1.15, mimo-v2.6-pro | `mimo --prompt "PROMPT"` | SIGINT (130); SIGTERM ignored for 19 s | yes: Kiwi's plugin rebinds it and hands over the pending task | yes, through the plugin |
| Kimi Code | 2.2.0, K3-256k | none: typed in with `tmux send-keys`, or `POST` to `kimi web` | SIGINT or SIGTERM | yes, at its first `kiwi` command | yes: its own background listener, or `kimi web` |

With `KIWI_AS` set to the seat's handle in the session's environment, the fresh Grok session found
and finished its task: `KIWI_AS` names the agent for `kiwi` commands (`src/cli/context.ts:53,83`).
It doesn't move the seat. Hooks pick their seats with `seatsFor` (`src/hooks/run.ts:52`), which
doesn't read it, so the seat stayed bound to the old session.

What else got in the way:

- **No end signal.** An agent did its task and never ran `kiwi task done`, because nothing asked it
  to. The first prompt must require it.
- **Dialogs on a first start:** Claude Code's one-time browser-tools notice, Codex's "Hooks need
  review" each time Kiwi's hooks change, and Kimi's "Trust this folder?", which swallowed the typed
  first prompt.
- **Permission prompts.** Grok asked before every chained command (`kiwi status; kiwi listen --now`
  doesn't match `Bash(kiwi:*)`) and every edit, even with `--permission-mode acceptEdits`. MiMoCode
  asked for `kiwi join` despite a `"kiwi *": "allow"` rule. Claude Code's prompts now reach the
  agent's person in the app (#627); the other harnesses' prompts don't.
- **The environment.** A session started from inside another agent's tmux inherited
  `CLAUDE_CODE_SESSION_ID` and a messaging token, and Kiwi took the Codex agent for Claude Code.
  `SESSION_MARKERS` in `src/launch/place.ts` strips these from Kiwi's own launches in Rex and tmux
  (`loginArgv`), not in Terminal.app (`terminalLine`); a loop needs the same.
- **A stray listener.** Killing Kimi left its `kiwi listen --once` running. It took the next
  message, so the next session saw nothing unread.
- **Grok's Stop hook didn't ask for a monitor** in the fresh session started with `KIWI_AS`, whose
  seat was still bound to the old session. The first prompt had to ask for it.
- **No re-entry outside Claude Code and Codex.** Re-entry is injected by the SessionStart hook
  (`src/hooks/answer.ts:358`). Grok and Kimi get only a Stop hook, and MiMoCode's plugin runs
  `hook listen`, so a fresh session there gets pending messages but not its task's checkpoint.
- **The model's choice.** MiMoCode's default model is the ended free tier; the person's choice is in
  `~/.local/state/mimocode/model.json`, so the loop passes `-m`.

## What the loop does

**The work a session is for.** Three kinds; the first two are the ones re-entry tells apart
(`partIn`, `packages/core/src/reentry.ts:22`):

- **Coding:** an open task the seat owns. The session lasts until the task is done. A coder can't
  mark a task with a reviewer done (`mayFinish`, `packages/core/src/state/fold-events.ts:262`), so
  it sends the task for review and the same session waits for the verdict, fixes on a rejection,
  and ends when the reviewer's approval makes the task done (owner, 2026-10-21). It also ends if the
  task is cancelled, archived or given to another owner.
- **Reviewing:** one open review round the seat judges. The session lasts until that round closes,
  whatever closes it: the seat's verdict, a new round that withdraws it
  (`packages/core/src/state/fold-events.ts:283-285`), or the task's reviewer changing. A new round
  gets a new session.
- **Answering:** a direct message to the seat with no work behind it. The session ends at its first
  idle with nothing unread; if it took on a task meanwhile, it becomes that task's coding session.

**The loop holds the seat between sessions.** The seat is bound to the loop itself, with a token
only the loop has. While it's held, nothing but the loop reads for the seat:

- no hook takes it or hands anything over (`src/hooks/answer.ts:416-427`);
- the daemon queues no wake for it;
- a `kiwi` command for the seat from any other session, `--as` included, refuses to read messages
  or move the seat's cursor. Today `--as` is accepted from any session (`src/cli/context.ts:83`),
  and Kiwi's own wake prompt tells a session to run `kiwi … --as … listen --now`
  (`packages/core/src/wake.ts:116`);
- a `kiwi listen` already running for the seat sees the hold before its next delivery, delivers
  nothing more and exits, leaving the cursor where it was (`src/agent/listen.ts:46`).

Anything that arrives meanwhile waits, unread, for the next session.

1. **The cutoff comes first.** The moment the work is done (the task's done, the round's close, the
   answer's idle), the loop holds the seat. Codex matters most: `codex queue` would run a turn on
   the old thread unseen in the app-server (`packages/core/src/wake.ts:76`,
   `src/daemon/wake.ts:186`). A wake already in flight runs a turn that can read nothing.
2. Then it waits until the session is idle, ends it with the harness's signal, and stops any
   `kiwi listen` it left running (Kimi).
3. It listens as the seat and starts a session for the next piece of work.
4. It installs the harness's hooks, if they're missing, before the start.
5. It starts the recipe's argv with the window's model and effort, in a clean environment plus
   `KIWI_CHANNEL` and `KIWI_AS`. Until step 6 the seat stays held, so the new session's hooks
   neither take it nor hand it anything; the first prompt already carries the work.
6. **It binds the seat to the new session itself:** to the session in
   `~/.claude/sessions/<pid>.json` for the Claude Code process it started; for Codex, whose hooks
   run in a shared app-server and don't see the loop's environment, to the thread whose rollout
   holds the launch's nonce, written into the first prompt; for each other harness, to the session
   it reports. The nonce tells two Codex sessions started in one folder apart, which rotation's
   handoff can't (`src/hooks/handoff.ts:91-94`).
7. **The first prompt carries the re-entry text** for that work: the task, its state and round, its
   newest checkpoint, and how to finish (`kiwi task review T7 --at SHA` for a reviewed task,
   `kiwi task done T7` for one without a reviewer, the verdict for a review round). That works in
   every harness, with or without a SessionStart hook. For Grok it also asks for a `kiwi listen`
   monitor.
8. Kimi Code takes no first prompt as an argument: the loop types it into the empty box once Kimi
   is ready and the folder is trusted, or sends it to `kimi web`.

**Rotation stays off** on a computer that runs the loop (`kiwi rotate off`). Its Stop hook would
otherwise still clear a loop's session past the context line (`src/hooks/rotate.ts:69`).

## How this meets the other plans

- **[new-agent.md](new-agent.md):** its principle and decision 1 say Kiwi "never starts one on its
  own: not to wake, not to restart, not to rotate", and its Not doing list rules out "restarting or
  resuming an agent's session". A per-task loop in a window the owner made is the owner's launch, but
  it does start a process per task, so decision 1 here changes that rule. Its recipe table (item 3)
  gets the first-prompt rows above. A paired computer's daemon counts each remote `launch` request
  against its limit of 3 every 10 minutes (`src/daemon/remote.ts:62`). A loop started once that
  way counts once; starting each task's session through that request would hit the limit.
- **[long-running-sessions.md](long-running-sessions.md):** checkpoints (item 1), re-entry
  (item 2) and the context line (item 4) stay; the loop's first prompt is built from re-entry.
  Rotation (item 3, Codex rotation) must stay off where the loop runs. opus-vm runs kiwi 0.20.4,
  which predates rotation, so no seat uses it today.

## Decisions for the owner

1. **Adopt per-task sessions for coders and reviewers**, with the lead long-running.
   Proposed: yes. Every task then starts with tens of thousands of tokens, not hundreds of
   thousands, and all five harnesses worked this way. The cost is the loop with a recipe per
   harness, and the change to new-agent decision 1.
2. **Rotation.** Proposed: remove it (`src/rotate/`, `src/hooks/rotate.ts`, `src/hooks/handoff.ts`,
   `kiwi rotate`) in the same release that ships the loop. Keep checkpoints, re-entry and the
   context line.
3. **When a session ends:** decided, when its task is done (owner, 2026-10-21); a reviewer's, at
   its verdict.

## Order of work

One issue and one PR each, with its CI gate:

1. The held seat: the loop binds a seat to itself with its token, so no hook, wake, `kiwi` command
   or running listener reads for it, then binds it to the session it names.
2. The loop for Claude Code: the clean environment, the re-entry first prompt, coding, reviewing
   and answering sessions, each with its end.
3. Codex: the new thread found by the nonce in its rollout and bound by the loop.
4. Grok, MiMoCode and Kimi Code recipes, one PR each, with their end signals, Kimi's typed first
   prompt and listener cleanup.
5. Remove rotation, if decision 2 is yes.
6. `docs/agents.md` says how a seat runs one session per task.
