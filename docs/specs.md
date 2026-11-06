---
description: How a person's ask becomes a spec, how a spec becomes tasks, and who says it's done.
group: Agents
order: 11
---

# Specs and tasks

A person asks. Agents write it down with them as a **spec**. A person approves it, and the first free agent starts it. Inside the spec, agents decide; outside it, they ask.

<!-- figure: spec -->

## A spec

The spec of a person's message is markdown: why, what's in and what's out, the questions still open, and the boxes that prove it done.

```markdown
# Export the board as CSV

## Done when

- [ ] The Tasks view has an Export button that saves `board.csv`
- [ ] Maya opens it in Numbers and the columns line up
```

- The lead, or any agent, drafts it: `kiwi spec write 150 --file spec.md`.
- Anyone edits it, and anyone comments on a line of it: in the app by selecting the words, or with `kiwi spec comment 150 "…" --on "the line"`. Comments are replies in the person's message's thread, so agents read them like any thread.

## Approval

A person approves the version they read: the person who asked, the owner, or someone the owner lets answer decisions. Never an agent. The approval names that version, so an edit made while someone reads can't slip through.

After approval, ticking a box is progress: `kiwi spec tick 150 "columns line up"`. Any other edit is a change, shown to people as a diff, and new work waits until a person approves it. Work already started carries on.

## It starts by itself

Once a spec is approved, the first agent with nothing else to do takes it. [`kiwi loop`](loop.md) does it when its seat is free; an agent in a long session is woken by the approval and runs `kiwi spec start 150`. It splits the spec into tasks filed under the person's message (`kiwi task add "…" --ask 150`), and free agents take the open ones.

With **Tasks only from approved specs** on (the owner's switch, on for every channel made in the app), every task is a step of an approved spec. A GitHub issue becomes work the same way: `kiwi task add --ask 150 --issue 12`.

## Stages

Nobody types a stage. It follows what happened.

| Stage               | When                                         |
| ------------------- | -------------------------------------------- |
| draft               | Until a person approves it                   |
| approved            | Waiting for an agent, with its place in line |
| working             | It has open tasks                            |
| delivered           | Every task done and every box ticked         |
| accepted or dropped | A person's verdict                           |

A person can also **send it back** with a note: it waits for an agent again, and the note is the planner's first instruction. Dropping it sets its open tasks aside.

## Tasks

A task is open, then doing, then done.

```bash
kiwi task add "freeze protocol v1" --ask 150 --start   # file it and take it
kiwi task assign T3 win "edge detection works; multi-monitor next"
kiwi task checkpoint T3 --file note.md                 # where it stands, for the next session
kiwi task done T3
```

`kiwi task start` takes a task only if nobody has it: when two agents race, one wins and the other is told who has it.

## In the app

The **Specs** view is where the work is: the Now card on top, then specs by what they need (waiting on you, working, waiting for an agent, drafts), each with its open tasks under it. A spec opens on three parts:

- **Spec**: the text, with comments in the margin beside the line they quote.
- **Inside**: the agents' work at a glance, each task with its pull request, and every message one click away.
- **Result**: Done when, the merged pull requests, what was tried, and Accept, Send back or Drop.
