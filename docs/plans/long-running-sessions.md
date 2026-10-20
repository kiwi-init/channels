# Plan: long-running agent sessions without unbounded context

Status: items 1 to 4 built, 2026-10-20 (rotation for Claude Code only); the rest is a proposal. Facts below were read from `main` at
`fcfaabf5`, from Claude Code 2.1.303 and its docs, from transcripts, and from probes on opus-vm.

## The problem, measured

A channel runs three kinds of agent: a **lead**, **coders** and **reviewers**. On opus-vm each
runs in a window of one tmux session (`inquizit`: `coordinator`, `opus-coder`, `astra-reviewer`,
`glm-reviewer`, `grok`) and stays in one harness session for days, so its context only grows.
Agents can't run `/clear` or `/compact` themselves; those are commands a person types.

Claude seats on Opus 5.5 (1M window), 2026-10-16 to 2026-10-19:

| Seat | Turns | Peak context | Now | Compactions (tokens before) | Cached input read |
| --- | --- | --- | --- | --- | --- |
| `opus-coordinator` (VM) | 2,066 | 966,845 | 441,918 | 967,552 | 848M |
| `opus-coder` (VM) | 2,007 | 638,359 | 365,947 | 638,637; 252,070; 309,112 | 527M |
| `opus-coder-2-local` | 1,953 | 964,787 | 256,276 | 965,418 | 904M |
| `opus-coder-1-local` | 1,661 | 823,283 | 385,586 | 824,106 | not measured |

`opus-coder-2-local` spent 1,527 of its 1,953 turns above 200k tokens. Claude Code compacts a
1M-window model at about 967k by default, so a seat carries hundreds of thousands of tokens of
finished work into every wake. That costs usage, slows each turn, and buries the current task.

## What we have to work with

**Kiwi today**

- The daemon never starts or resumes a Claude Code process. A Claude seat wakes itself through
  the `kiwi hook listen` hook (`asyncRewake`); Codex and OpenCode are woken by a command into
  their live session (`wakePath`, `packages/core/src/wake.ts`).
- SessionStart injects the brief and unread messages only (`src/hooks/answer.ts`), the same for
  every `source`. No task state, notes or checkpoint. After a compaction the agent keeps only what
  the summary happened to keep about its task, branch and review round.
- Nothing reads context size. `src/harness.ts` already tails the Claude transcript and the Codex
  rollout every 3 s for the model and the current tool.
- A seat follows its session: a new session in the same Claude process takes the seat at its
  first hook (`seatsFor`, `src/seats.ts`).

**Probed on opus-vm, Claude Code 2.1.303, in a throwaway tmux session**

- `tmux send-keys "/clear" Enter` into an idle Claude pane clears it. Same process (PID
  236399), new session id (`248bd890…` to `2b39162e…`), new transcript file.
- After `/clear` the agent's shell already sees the new `CLAUDE_CODE_SESSION_ID`, so a plain
  `kiwi` command finds the new session, not the old one.

**From the Claude Code docs**

- SessionStart reports `source` (`startup`, `resume`, `clear`, `compact`), and its
  `additionalContext` reaches the agent before its next prompt.
- `autoCompactWindow`, `--autocompact` and `CLAUDE_CODE_AUTO_COMPACT_WINDOW` move
  auto-compaction to an absolute size (100k to 1M).
- A Claude process started in tmux carries `TMUX` (the server socket) and `TMUX_PANE` in its
  environment, and its hooks inherit them. On opus-vm the coordinator's process has
  `TMUX_PANE=%0` and the coder's `%2`, the panes of the `coordinator` and `opus-coder` windows.

## Principle

**A session is disposable; the seat and the channel hold the state.** What an agent's work needs
in order to continue (its task, branch, last commit, open review round, what it tried, what is
next) lives in the channel, where a cleared session, another agent or a person can read it.
Clearing a session then costs a re-read, not the work.

Clear at natural boundaries, when the agent is idle: a reviewer after its verdict, a coder after
`task done`, the lead when its context passes a line. Keep auto-compaction as the backstop.

## The plan

### 1. Checkpoint: the agent writes down where it is

`kiwi task checkpoint T7 --file note.md`: short and structured (branch, last SHA, done, next,
traps), at most 4,000 characters. Stored as a `task.update` note marked `checkpoint: true`, so
it is signed, syncs, shows on the task (labelled in `kiwi task show`) and survives the machine;
older clients keep it as a plain note. Built in item 1.

Not built yet: a checkpoint for a seat with no task, such as the lead's. Until then the lead's
re-entry carries the board itself. When it lands, the lead's checkpoint must name every open
task and question, the rule `kiwi compact` already enforces for the channel summary.

### 2. Re-entry: SessionStart puts the agent back on its work

On every SessionStart that isn't `resume` (`startup`, `clear`, `compact`), inject beside the
brief:

- each open task the seat owns, with its state and the review round it is in;
- each open review round the seat judges, with its commit;
- the newest checkpoint on each task, else its last note;
- for the lead, the open board;
- the channel's compact summary.

Built in item 1 (`reentryText`, `packages/core/src/reentry.ts`), capped at 4,000 characters so
the whole SessionStart text stays under Claude Code's 10,000-character inline limit. This one change makes `/clear`,
auto-compaction and a restarted terminal all land the agent on its work, and it is worth building
even if nothing below ships.

### 3. Rotation: a fresh session typed into the seat's pane at a boundary

Built in item 4 for Claude Code (`src/hooks/rotate.ts`, `src/rotate/`). The plan first put this in
the daemon; it ended up in the Stop hook, which already knows the seat, its tasks, its context and
whether anything is waiting for it, plus one detached process that does the typing.

- **The pane.** The Stop hook reads `TMUX` (the server socket) and `TMUX_PANE` from its own
  environment, which Claude Code passes down from the pane it runs in. A seat outside tmux is never
  rotated; it keeps the backstop. (Claude Code 2.1.304 also records the pane in
  `~/.claude/sessions/<pid>.json` as `"tmux": "<session>:@<window>.%<pane>"`.)
- **The trigger.** At a Stop that hands nothing over (no unread messages, no nudge, not
  `stop_hook_active`), every seat the session serves must be ready (`rotationAt`,
  `src/rotate/decide.ts`):
  - a seat with open tasks: past the line, with a checkpoint on each written since its nudge;
  - the lead with none: past the line;
  - any other seat with none (a coder after `task done`, a reviewer after its verdict): past
    100k (`ROTATE_FLOOR`), so a small context isn't cleared for nothing;
  - never while a review round it judges is open, or a question of its to a person is.
- **The guard.** `kiwi rotate send`, started detached by the hook, waits up to 15 minutes, and on
  every round checks all of these, else waits:
  - rotation is still on for this computer;
  - the session is idle and still the same session (`~/.claude/sessions/<pid>.json`); a session
    already cleared by hand is left alone;
  - the pane is the one it was given (same tmux server, pane process and terminal), and the Claude
    process leads the terminal's foreground process group, so it holds the pane's input;
  - Claude Code's input box, read between its two rule lines in `tmux capture-pane -e`, holds only
    the dimmed placeholder; anything else on screen (a draft, a dialog, a menu) means wait;
  - no attached tmux client pressed a key in the last 10 seconds.
  One sender per session (an exclusive lock file, released only by its holder). What each one did
  goes to `rotate.log` in the Kiwi folder.
- **The act.** It types `/clear` without Enter, then waits up to a second for the box to show
  exactly `/clear` with every check above still holding, and only then presses Enter. If the box
  shows something else it erases its six characters when they are the last thing in it; if the
  session or the pane changed, it sends nothing more. SessionStart (`clear`) then re-injects, and
  the seat moves to the new session id at that hook. A narrow window remains between that last
  read and Enter: a key pressed in those milliseconds lands in the same line. Probed 2026-10-20
  against Claude Code 2.1.304: a draft (one ending in the prompt glyph included) was left alone,
  and once the input was empty the session was cleared (new session id, same process).
- **Optional, off by default, and not loaded unless switched on** (owner's requirement,
  2026-10-19). Switched on per computer (decision 3): `kiwi rotate on` writes it to that
  computer's Kiwi config. The tmux code (`src/rotate/pane.ts`) is imported only by
  `kiwi rotate send` and only when rotation is on; with it off the hook stops at the config check.
- **Not built yet:** a person or the lead asking a seat to rotate through the channel. A person at
  the pane can type `/clear` themselves.

### 4. The line and the nudge

- **Measure.** Add `context: {used, window}` to the activity the daemon collects (`Activity`,
  `packages/core/src/protocol.ts`; `claudeActivity`/`codexActivity`, `src/harness.ts`). Claude:
  `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` on the newest assistant
  line. Codex: the newest `token_count` event (`last_token_usage`, `model_context_window`). Only
  the numbers leave the transcript, as `harness.ts` promises today. Built in item 2. A Claude
  transcript doesn't record the window, so a Claude seat reports `used` only. Between a compaction
  and the next reply the size is unknown, never the old one.
- **Where it shows.** On the agent's own lane in the app's Agents tab, and in the hooks that act on
  it. Not in `kiwi status`: that is the channel's one screen, and a per-agent number there is
  noise for everyone else. Built in item 2: the lane's status line, and the expanded agent list
  under the composer, as "262k of 1M context", in the alert colour past the line.
- **The nudge.** When context passes the line (proposed: 250k on 1M models), the Stop hook blocks
  once with: "Context is at N. Write `kiwi checkpoint`, then end your turn." Once per crossing,
  never in a loop (`stop_hook_active`). The checkpoint then triggers the clear. Built in item 2
  for Claude Code seats (`src/hooks/context-line.ts`): the line is 250k (`CONTEXT_LINE`), read
  from the Stop hook's `transcript_path`; the nudge names each open task the seat owns and the
  `kiwi task checkpoint` command for the first; a seat with no open task isn't nudged. It comes back
  only after the context fell under the line (a compaction, a `/clear` starts a new session).
- **The backstop.** `autoCompactWindow` at about 400k in each seat's folder
  (`.claude/settings.local.json`), never in a person's global settings. Rotation should come
  first; this catches a seat outside tmux or one that never reaches a boundary. Decided: 400k
  (owner, 2026-10-19). Kiwi doesn't write it: it is a setting in the seat's folder, set where the
  seats run, so a channel's other members carry none of it.

## Per role, at a glance

| | Lead | Coder | Reviewer |
| --- | --- | --- | --- |
| Cleared when | idle, past the line, after a checkpoint | `task done`, or past the line after a checkpoint | after each verdict |
| Comes back with | board, open questions, its checkpoint | task, branch, SHA, checkpoint | nothing; the next brief is complete |
| Backstop | auto-compaction at ~400k | same | same |

## Other harnesses

The Codex, OpenCode and Grok seats run in tmux too. Claude Code ships first. Probed 2026-10-20 in
throwaway tmux sessions on a laptop, reading each TUI's own command list (no model calls):

| Harness | Version | New conversation | Compact | How Kiwi wakes it |
| --- | --- | --- | --- | --- |
| Claude Code | 2.1.304 | `/clear` | `/compact` | its own listener hook |
| Codex | 0.163.0 | `/new`, `/clear` | `/compact` | `codex queue --thread <recorded thread>` |
| OpenCode | 2.0.32 | `/new`, `/clear` | none offered on an empty session | `opencode api session.prompt` with the recorded session |
| Grok Build | 1.0.62 | `/new`, `/clear` | `/compact`; `/context-window` sets the window | its listener (no wake command) |
| Kimi Code | K3 | `/new` (`/clear`) | `/compact <instruction>` | only when served (`kimi web`) |

Codex and OpenCode are woken by a command that names the recorded thread or session, so after a
`/new` typed into the pane the wake would still go to the old one. Rotating them needs the seat's
record to move to the new thread first; that is the next probe. Until then: re-entry (step 2)
through its SessionStart hook where it has one, and its own compaction setting as the backstop
(Codex: `model_auto_compact_token_limit`, and `compact_prompt` telling it to keep the task, branch,
SHA and round; Grok: `/context-window`).

## Risks to check before enabling rotation

- **A second listener after `/clear`.** Probed 2026-10-20 with Claude Code 2.1.304 in tmux against
  a local relay: the earlier session's `hook listen` keeps running after `/clear`, but no second
  one arms, because `arm` (`src/hooks/listen.ts`) refuses while any listener holds the seat. The
  next message reaches the new session once, as Stop hook feedback, and the new session arms its
  own listener after that turn. The defect was smaller: the listener recorded the delivery under
  the earlier session id, which no hook commits again, so a hook of the new session could hand the
  same message over a second time. Fixed in item 3: a delivery records the harness process too,
  and a hook commits what any earlier session of its own process was handed.
- **Typing into a pane.** `send-keys` writes into whatever has focus. The guard checks idle and an
  empty input line right before sending, but a person could start typing in between. Keep the gap
  to milliseconds, and don't rotate a seat whose tmux client sent a key in the last few seconds
  (`#{client_activity}`).
- **Usage fields are not a contract.** Claude's transcript `usage` and Codex's `token_count` are
  today's shapes; a change shows as "unknown", never as a wrong number.

## Decisions for the owner

1. The line and the backstop on 1M models: decided, 250k and 400k (2026-10-19).
2. Where a checkpoint lives: decided and built as a signed note on the task (item 1).
3. How rotation is switched on: decided, per computer (2026-10-20). `kiwi rotate on` in that
   machine's Kiwi config, off by default, the tmux code loaded only when on.

## Order of work

One issue and one PR each, with its CI gate:

1. Re-entry: task state, checkpoints and the lead line at SessionStart (step 2), with
   `kiwi task checkpoint` (step 1), and every hook's output kept inside Claude Code's inline limit,
   shared between the seats a session serves, with no message marked read that wasn't shown.
2. Context in activity and on the Agents lane; the Stop-hook nudge. Built on the item 1 branch.
3. The duplicate-listener probe and its fix. Built: no second listener; deliveries across a
   `/clear` are committed by the new session.
4. Rotation for Claude Code seats in tmux, behind the switch from decision 3: the pane, the
   trigger, the guard and the act. Built, except asking a seat to rotate through the channel.
5. Probe and add Codex, OpenCode and Grok.
