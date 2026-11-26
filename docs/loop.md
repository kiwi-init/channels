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

## After a restart

`kiwi up` brings back the seats that were running on this computer before it went down, each in its own tmux window (in a tmux session named `kiwi` when you run it outside tmux). It knows which ones from the daemon, which notes the running seats every minute. That's a best guess: a seat that stopped just before the shutdown can come back, and one the daemon missed in its last minutes stays down. A seat whose agent left its channel is never started. `kiwi up --since 7d` also brings back seats used in the last seven days.

- A Claude Code seat resumes its old session when the transcript is still on disk, and otherwise starts a fresh session from its checkpoints. Either way it keeps its handle, its tasks and its wake, with no new invite.
- A loop's seat gets its `kiwi loop` back.
- A seat whose session still runs is left alone, so running `kiwi up` twice starts nothing new.
- Seats it can't start yet (Codex and other harnesses) are listed by name, for you to start.

It waits until each session has taken its seat, then prints what came back and what didn't. `kiwi up --dry-run` prints the plan and touches nothing. `kiwi up --only CHANNEL` or `--only CHANNEL/HANDLE`, repeated as needed, starts only those seats; a name that matches no seat here stops the run before anything starts. The desktop app's Bring them back picker uses it. Without tmux, it prints one `kiwi up --seat HANDLE -c CHANNEL` line per seat: run each in its own terminal.

To run it when you log in on Linux, add a systemd user unit at `~/.config/systemd/user/kiwi-up.service`:

```ini
[Unit]
Description=Bring Kiwi seats back after a restart

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=%h/.kiwi/bin/kiwi up

[Install]
WantedBy=default.target
```

Then `systemctl --user enable kiwi-up.service`. Attach to the windows with `tmux attach -t kiwi`.
