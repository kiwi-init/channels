# Plan: long-running agent sessions without unbounded context

Status: proposal, 2026-10-19. No `src/` change yet. Facts below were read from `main` at
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

### 3. Rotation: the daemon clears the seat's pane at a boundary

The daemon on the seat's machine already knows the seat's process and whether it is busy. It
gains:

- **The pane.** At SessionStart the hook records `TMUX` (the server socket) and `TMUX_PANE` on the
  seat. A seat outside tmux is never rotated; it keeps the backstop.
- **The trigger.**
  - Reviewer: its verdict (`task approve|reject`) posted.
  - Coder: `task done`, or the task handed to someone else.
  - Lead: context past the line (below).
  - Any seat: a checkpoint posted while context is past the line.
  - A person, or the lead, asking for it, carried as an event and done by the seat's own daemon.
- **The guard.** Send keys only when all of these hold, else wait and retry:
  - the session is idle (`~/.claude/sessions/<pid>.json`, which `claudeActivity` already reads);
  - the pane's input line is empty (`tmux capture-pane`), so a person typing there is never
    interrupted;
  - no `ask-human` from this seat is waiting;
  - the seat has a checkpoint newer than its last commit, or the trigger is a verdict or
    `task done`.
- **The act.** `tmux -S <socket> send-keys -t <pane> /clear Enter`. SessionStart (`clear`) then
  re-injects, and the seat moves to the new session id at that hook.
- **Optional, off by default, and not loaded unless switched on** (owner's requirement,
  2026-10-19). The tmux code lives in its own module that the daemon imports only when rotation is
  on, so a channel that never uses it carries none of it. Who switches it on, and at what scope,
  is still open (decision 3).

### 4. The line and the nudge

- **Measure.** Add `context: {used, window}` to the activity the daemon collects (`Activity`,
  `packages/core/src/protocol.ts`; `claudeActivity`/`codexActivity`, `src/harness.ts`). Claude:
  `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` on the newest assistant
  line. Codex: the newest `token_count` event (`last_token_usage`, `model_context_window`). Only
  the numbers leave the transcript, as `harness.ts` promises today.
- **Where it shows.** On the agent's own lane in the app's Agents tab, and in the hooks that act on
  it. Not in `kiwi status`: that is the channel's one screen, and a per-agent number there is
  noise for everyone else.
- **The nudge.** When context passes the line (proposed: 250k on 1M models), the Stop hook blocks
  once with: "Context is at N. Write `kiwi checkpoint`, then end your turn." Once per crossing,
  never in a loop (`stop_hook_active`). The checkpoint then triggers the clear.
- **The backstop.** `autoCompactWindow` at about 400k in each seat's folder
  (`.claude/settings.local.json`), never in a person's global settings. Rotation should come
  first; this catches a seat outside tmux or one that never reaches a boundary.

## Per role, at a glance

| | Lead | Coder | Reviewer |
| --- | --- | --- | --- |
| Cleared when | idle, past the line, after a checkpoint | `task done`, or past the line after a checkpoint | after each verdict |
| Comes back with | board, open questions, its checkpoint | task, branch, SHA, checkpoint | nothing; the next brief is complete |
| Backstop | auto-compaction at ~400k | same | same |

## Other harnesses

The Codex, OpenCode and Grok seats run in tmux too. Each TUI has its own command for a new
conversation; none was probed. Claude Code ships first. Until another harness is probed:
re-entry (step 2) through its SessionStart hook where it has one, and its own compaction setting
as the backstop (Codex: `model_auto_compact_token_limit`, and `compact_prompt` telling it to keep
the task, branch, SHA and round).

## Risks to check before enabling rotation

- **A second listener after `/clear`.** The old session's `hook listen` keeps running in the same
  process until a message, its week or the pid ends, and the daemon's hook slot is keyed per
  session, so the new session arms a second one. Both could deliver the same message. Probe it,
  and make a listener exit once its session no longer holds the seat.
- **Typing into a pane.** `send-keys` writes into whatever has focus. The guard checks idle and an
  empty input line right before sending, but a person could start typing in between. Keep the gap
  to milliseconds, and don't rotate a seat whose tmux client sent a key in the last few seconds
  (`#{client_activity}`).
- **Usage fields are not a contract.** Claude's transcript `usage` and Codex's `token_count` are
  today's shapes; a change shows as "unknown", never as a wrong number.

## Decisions for the owner

1. The line (proposed 250k) and the backstop (proposed 400k) on 1M models.
2. Where a checkpoint lives: decided and built as a signed note on the task (item 1).
3. How rotation is switched on and at what scope. Settled so far: optional, off by default, not
   loaded unless on. Not per seat. To discuss.

## Order of work

One issue and one PR each, with its CI gate:

1. Re-entry: task state, checkpoints and the lead line at SessionStart (step 2), with
   `kiwi task checkpoint` (step 1), and every hook's output kept inside Claude Code's inline limit,
   shared between the seats a session serves, with no message marked read that wasn't shown.
2. Context in activity and on the Agents lane; the Stop-hook nudge.
3. The duplicate-listener probe and its fix.
4. Rotation for Claude Code seats in tmux, behind the switch from decision 3: pane recording, the
   guard, and asking a seat to rotate.
5. Probe and add Codex, OpenCode and Grok.
