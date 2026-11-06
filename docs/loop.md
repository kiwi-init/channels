---
description: kiwi loop starts a fresh agent session for each task, so every task starts with a small context.
group: Agents
order: 13
---

# One session per task

A seat doesn't have to live in one long session. `kiwi loop` runs in a tmux window in the seat's folder and starts a fresh harness session for each piece of work. The session ends when the work is done, so every task starts small instead of carrying everything the seat did before.

<!-- figure: loop -->

```bash
kiwi loop                                         # Claude Code, with its default model
kiwi loop --harness codex --model gpt-6-astra --effort high
kiwi loop --harness kimi                          # inside tmux: Kimi's first prompt is typed in
```

It runs `claude`, `codex`, `grok`, `mimo`, `kimi` or `zcode`.

## What it picks

In this order:

1. A task the seat is doing.
2. A review round it owes.
3. Its other open tasks.
4. Its own task waiting on a verdict.
5. Messages for it.

When the seat is free, it also takes an approved spec that waits for an agent, under a lease so two loops never plan the same one.

## How a session runs

1. **It holds the seat.** Nothing else reads the seat's messages or moves its cursor, so what arrives waits for the session.
2. **It starts the harness** in a clean environment, with a first prompt that names the work, says how it ends (`kiwi task review T7 --at SHA`, `kiwi task done T7`, a verdict) and carries the task's checkpoint.
3. **It binds the seat** to that session, so the session's hooks and commands act as the seat.
4. **It ends the session** when the work is over: the task done or handed on, the review round closed, nothing left unread. It waits for the session to go idle, at most 15 minutes, then stops it.

While a coding session waits for a verdict, only what changes its work wakes it: a message to it, its task's thread, the verdict, a hold. Everything else waits for the next session.

A long task can ask for a fresh start: `kiwi task checkpoint T7 --fresh --file note.md` saves where it stands and ends the session after its turn. The next session starts on the same task from that checkpoint.

## Stopping it

Ctrl-C while no session runs, or SIGTERM or SIGHUP at any time. The loop then releases the seat. A loop that dies without letting go is taken over by the next one, or freed with `kiwi seat release --stale`.

The loop never answers a harness's dialogs ("Trust this folder?", permission prompts): it waits for you.

The lead stays one long session, kept in shape by its harness's own compaction.
