# Plan: Tasks v2, asks, work and decisions

Status: adopted by the owner, 2026-10-21 (#220), with the defaults under "Decisions"; nothing built
yet. Each rollout step is its own task and PR (T223 to T229). This is the lead's synthesis
(merry-llama) of three drafts written in channels-dev: proud-yak's (start from what a person
tracks), brave-egret's (start from the event log) and wise-heron's (start from how agents hand work
on). Each idea below is credited to its draft. Code facts were read from `main` at `0cd9e414`.
Numbers like #18 are channels-dev messages, not GitHub issues.

## The principle

Tasks v2 is internal to Channels. It exists so very large numbers of agents can work together,
and it must never take over a person's own workflow.

- **People keep their own process:** their trackers, branching, review habits and merge rules.
  Channels reads them and links to them (GitHub issues, PRs, whatever the project already uses).
  It never replaces them, and it never asks a person to learn a new process.
- **The agent side is invisible unless someone looks:** work, capsules, `pass`, holds, evidence.
- **The person's side asks nothing new.** Any message can be an ask, and the lead drafts its
  done-when without a click.
- **Proofs follow the project's own rules, read from the project.** `ci-ok`, squash-merge and one
  task per PR are this repo's conventions. They are not Channels behaviour, and nothing below
  hardcodes them.

## Why

A task is still a ticket built for people (`Task` in `packages/core/src/state/types.ts`): a
title, one owner, `todo → doing → review → done`, notes and review rounds. That shape comes from
human teams, where work lasts days, one person is accountable, and status is read out in a
meeting. With agents, work lasts minutes, and context is scarcer than people. Evidence (a green
check, an approved round, an OK'd screenshot) also says more than a state someone declares.

What that costs today, measured in this channel:

- **The person never tracks a task.** Jow sent 22 messages in #1–#181, and not one of them
  addresses a task. Each is an ask, an amendment, an answer, or a verdict on a whole ask
  (proud-yak).
- **State is typed by hand.** `state`, `approvedBy`, `cancelled`, `closedSeq`, `workedBy` and
  `touched` are either typed or copied off an event someone typed (brave-egret).
  `task.update {state: "done"}` is a member saying so, and the fold believes it.
- **Context is spread over five places:** the session, the free-text notes (only the last
  checkpoint survives, cut at 1.5k), `workedBy`, `touched` and `areas` for `task who`, the branch,
  and a thread nobody re-reads. Four mechanisms move it: checkpoint, assign, review round and drop
  (wise-heron).
- **Dropping work is expensive.** #119 "discard all" took four cancels across T25, T26, T27 and
  T81, one task was cancelled twice by two agents, and T25 still reads "done" for work that was
  thrown away.

## The common thread

The three drafts started from opposite ends and landed on the same skeleton:

1. **Two layers.** A person's **ask**, and the agents' **work** under it.
2. **A meeting point.** A typed **decision** that holds named work. It is the only other thing
   that reaches a person.
3. **Every ask carries a done-when:** a checkable list of proofs, drafted by the lead.
4. **Nobody types a state.** State is folded from what happened.
5. **Holding work is a lease with a TTL, not ownership,** so a silent agent frees its work
   without anyone saying "blocked".
6. **Dropping an ask is one event,** and its work goes with it.
7. **Migration is a legacy reader in the fold.** The log stays append-only, ids are kept, and
   `--re` groups old tasks into asks.

Each draft also brings one idea the others don't have. v2 keeps all three, as invariants:

- **Every row a person sees is their own words, or a question to them** (proud-yak). An ask is
  the person's message, never rewritten, and their later messages amend it. A question that holds
  nothing up isn't a decision: it goes in the digest.
- **Nobody sets the state** (brave-egret). Only `ask`, `evidence`, `verdict` and `drop` move
  it. A verdict binds to a ref (a sha or a file hash), so a new push voids an old yes, and review
  rounds stop being something we track. History that was set by hand stays marked `declared`, so
  it is never upgraded to proven.
- **A cold session can resume any work from its capsule** (wise-heron). Work carries a capsule
  (branch, head, what's known, what was tried, traps, next step), capped near 2k tokens. If the
  capsule can't hold it, the work splits. A new session, a handoff, a review and an agent leaving
  all become one move: `pass`.

## The units

Today:

```ts
interface Task {
  id: number;
  title: string;
  state: "todo" | "doing" | "review" | "done";
  owner?: string;
  notes: TaskNote[];
  proof?: TaskProof[];
  review?: string;
  approvedBy?: string;
  cancelled?: boolean;
  closedSeq?: number;
  from?: number;
  source?: number;
  areas?: string[];
  touched?: Record<string, number>;
  workedBy: string[];
  rounds: ReviewRound[];
}
```

v2:

```ts
type Ref =
  | { kind: "sha"; repo: string; sha: string }
  | { kind: "pr"; repo: string; number: number }
  | { kind: "file"; hash: string; url?: string }
  | { kind: "release"; version: string };

type Proof =
  | { need: "merged"; check: string }
  | { need: "released"; version: string }
  | { need: "verdict"; by: string; on: "head" | "file" }
  | { need: "page"; url: string };

interface Ask {
  id: number;
  by: string;
  words: string;
  amends: number[];
  doneWhen: Proof[];
  work: number[];
  tried: string[];
  state: "moving" | "needs-you" | "stuck" | "delivered" | "closed" | "dropped";
}

interface Work {
  id: number;
  ask: number;
  from?: number[];
  title: string;
  head?: Ref;
  hold?: { seat: string; session: string; until: number };
  capsule?: Capsule;
  evidence: { ref: Ref; ok?: boolean; by: string; seq: number; source: "github" | "member" | "declared" }[];
  verdicts: { on: Ref; ok: boolean; by: string; seq: number; note?: string }[];
  stage: "open" | "building" | "proving" | "red" | "yours" | "done" | "dropped";
  waits?: { on: "decision" | "ci" | "review" | "lock" | "work"; ref: number | string };
}

interface Capsule {
  seq: number;
  by: string;
  branch?: string;
  head?: string;
  know: string[];
  tried: string[];
  traps: string[];
  next: string;
  files: string[];
}

interface Decision {
  id: number;
  kind: "intent" | "taste" | "irreversible" | "scope" | "choice";
  holds: number[];
  question: string;
  options: string[];
  answer?: { seq: number; by: string; option?: number; text: string };
}
```

These fields are derived, and no event carries them: `Ask.state`, `Work.stage`, `Work.waits`, who
holds the work, and its warm seats. Warm seats come from past holds, and they are what `task who`
ranks (`routing.ts` keeps its scoring). Ids stay the log seq, so `T169` is still 169, and `T169-…`
branches keep linking through `taskOfBranch` (`packages/core/src/work.ts`).

From today's `Task`:

- `owner` becomes `hold.seat`.
- `workedBy` and `touched` become the warm seats.
- The checkpoint note becomes `capsule`, and `areas` becomes `capsule.files`.
- `rounds` and `proof` become `evidence` and `verdicts`.
- `state`, `approvedBy`, `cancelled` and `closedSeq` are gone; `stage` replaces them.

`Work.stage` is checked from the top down:

1. `dropped`: a drop covers it.
2. `done`: every proof of its ask holds at its head.
3. `red`: the newest check at its head failed.
4. `yours`: a verdict is owed at its head.
5. `proving`: a PR is open and checks are running.
6. `building`: a hold is live.
7. `open`: none of the above.

## Trust rules

From brave-egret's review of the synthesis (#197):

- **Only drain-sourced evidence** (`source: "github"`) satisfies `merged` or `released`. A
  member saying "merged" is just a typed state under another name.
- **`page`** is satisfied by a client fetch with a content hash, or by a person's verdict. A
  member saying it's up doesn't count.
- **`merged` means the project's own green, read from the project.** `check` names the check the
  project already requires (for example the required status checks of its default branch), and it
  must be green at the exact head that was merged. That holds for any merge style: with squash, the
  commit on the default branch is a new sha whose checks run later. For this repo, `check` is
  `ci-ok`. That is a project setting, not a Channels default.
- **Clock-based states stay out of the fold.** `stuck` and stale depend on the clock, so two
  clients replaying at different times would disagree. They are computed at read time from the
  relay's `rts`, and nothing is ever gated on them.

## What a person still approves

From wise-heron's list:

- **Intent:** the done-when, which the lead drafts and the person edits only if it's wrong.
- **Taste:** visual changes, as screenshots.
- **Irreversible steps:** releases, destructive steps, credentials, force pushes.
- **Scope:** anything outside the charter, such as a finding an agent wants to fix.

Progress, assignment, splits, handoffs, review rounds and merges that the project's own rules
allow never reach them. A gate reuses whatever the project already has: a PR review stays a PR
review.

## What the synthesis changed from the drafts

- **No renamed CLI.** wise-heron proposed `leg` and `gate`. v2 uses plain words (ask, work,
  decision), and `pass` is the one new verb.
- **Fewer clicks than brave-egret.** A machine-sourced proof (the drain's merge or release, a
  fetched page hash) closes an ask on its own. Only taste needs the person's verdict, and the
  person can always accept or drop by hand.
- **Amendments by reply, not by clock.** proud-yak chained a person's messages sent within 10
  minutes of each other. In v2, a reply to an ask, or a message in its thread, amends it; the lead
  files the rest with `kiwi ask amend`.
- **A finding isn't work until it's adopted** (proud-yak). T96 would have been a *scope* decision
  ("adopt it?") before any PR existed, not a PR that then got dropped.

## Walkthrough: the UI round, #18 to #119

| Today | v2 |
| --- | --- |
| #18 and three screenshots; the lead adds T25, T26 and T27 by hand, pointing at the screenshots rather than at #18 | #18 opens A18, amended by #19–#22. Done-when: the person's verdict on a shot |
| Each builder claims a task, which moves it to `doing` | Builders take holds on W25–W27 (`building`) |
| Mockups posted as chat (#43–#45, #87–#89); T25 marked done by hand with a note pointing at them | Each mockup is file evidence, and each work goes to `yours` by itself. Needs you shows one line, "A18: 3 shots to look at": a *taste* decision holding W25–W27 |
| #79 "the best of the three" becomes T81 | #79 amends A18. W81 is `join(25, 26, 27)`, and its capsule is the union of the three |
| #116 is an escalation with options | #116 is a *choice* decision holding W81 |
| #119 "discard all": four cancels, four notes, four done cards | One `ask.drop A18`. Holds free, and the capsules fold into `A18.tried`, so the next ask in this area starts from what was rejected |

The person saw one row in their own words the whole time, plus the questions that held it up.

## Rollout

Each step is its own task and PR, stands on its own, and never needs an earlier step rolled back.

1. **Asks.**
   - `task add` requires `--ask` or `--from`.
   - A backfill groups old tasks by `source` and `from`.
   - The board and `kiwi status` group by ask.
   - Task state is still set by hand. This is the biggest win for the person, at the smallest
     risk.
2. **Decisions hold work.**
   - `ask-human --holds`.
   - Needs you shows decisions that hold something, plus delivered asks waiting on an OK.
     Everything else goes to the digest.
3. **Evidence and verdicts on refs.**
   - The stage is derived. New clients stop writing `state`, old values become `declared`, and
     rounds fold into verdicts. This step needs a protocol bump.
   - In-progress check runs have to reach the channel first. Today `worthSaying` in
     `packages/core/src/client/github.ts` keeps only `completed` check runs and workflow runs.
4. **Capsule and `pass`.**
   - The checkpoint becomes a structured capsule.
   - A fresh session starts from it: re-entry (`packages/core/src/reentry.ts`) injects it today's
     way. A reviewer gets the capsule plus the diff only.
   - This fits [per-task-sessions.md](per-task-sessions.md): one fresh session per piece of work,
     with the capsule as its first prompt. The synthesis also had `kiwi rotate` on by default;
     that conflicts with the owner's decision to remove rotation, so this plan drops it.
5. **A hold is a lease.**
   - The owner is derived, and a stale hold frees the work.
   - This comes after the capsule, so freed work never starts cold (wise-heron, #191).
   - Waiting work holds nothing. When checks come back, they wake the warmest seat, so a long CI
     run can't expire a hold.

## What it breaks

- **Protocol.**
  - New ops, roughly `ask.open`, `ask.amend`, `ask.drop`, `ask.accept`, `work.open`, `work.pass`,
    `evidence`, `verdict` and `decision.open`.
  - `task.add`, `task.claim` and `task.update` (12 optional fields) are folded from old logs and
    never written again.
  - Older clients refuse the new ops: `wellFormedEvent` (`packages/core/src/protocol.ts`) returns
    false for an op it doesn't know, so the whole message is dropped as malformed. Every client
    has to understand the new ops before any client writes them.
- **CLI.** `task start`, `done`, `review`, `approve`, `reject`, `cancel`, `claim`, `handoff` and
  `proof` mostly give way to `kiwi ask`, `kiwi work pass` and `kiwi verdict ok|no <ref>`.
  `note` stays. `task` stays as an alias for one release.
- **Hooks.** A wake opens with the ask's words and its done-when, not a task title. SessionStart
  injects the capsule of the held work.
- **Readers of `.state`.** 20 files read a task's state directly: in the web app (`lanes.ts`,
  `views.ts`, `task-cards.ts`, `task-actions.ts`, `task-details.tsx`, `voice/*`), in the CLI and
  hooks (`src/agent/tasks.ts`, `src/hooks/context-line.ts`), and in core (`standup.ts`,
  `reentry.ts`, `load.ts`, `ci-red.ts`, `format.ts`, `places.ts`, `work.ts`). They read `stage`
  instead, and the board groups work under asks.
- **The GitHub drain becomes load-bearing.** If delivery is down, nothing moves, so a card has
  to say "no evidence feed" rather than blame an agent.

## Migration

The log is signed and append-only, so nothing is rewritten. The fold gets a legacy reader for
events before a cut-over seq:

- Each `task.add` becomes a work item with the same number.
- Tasks that share a `source` (`--re`) collapse into one ask. Tasks with a `from` go under their
  parent's ask. The rest get an implicit ask, which the lead can file.
- `proof` becomes file or url evidence, and a round with `at` becomes a verdict on that sha.
- A hand-set `done` or `cancelled` becomes evidence marked `declared`. A cancelled task becomes
  dropped work, so its history stays readable.
- The last checkpoint becomes one legacy line in `capsule.know`. A `doing` task with an active
  owner gets a hold.

An owner-signed backfill only appends events (proud-yak). Replaying from 0 gives every client the
same board.

## What it costs

- **About five PRs,** across core, CLI, hooks and web, plus a protocol bump at step 3. Step 1
  alone is small.
- **The lead writes one done-when line per ask.** A bad line leaves the ask open; it never closes
  it wrongly.
- **Derived state is only as good as the evidence feed.** The stage lags the drain by seconds,
  where today an agent can say "done" instantly.
- **About 300–800 tokens per capsule write,** at each milestone. That is less than a cold session
  re-reading a thread.
- **Capsules can go stale.** Each `pass` checks the capsule against the branch head, and the cold
  reviewer tests it every round.

## Decisions

Taken with the plan's defaults when the owner adopted it (#220):

1. **Step 1 starts first:** asks, with state still set by hand. Before step 3, every client also
   has to keep events with unknown ops (T224).
2. **Names:** ask, work and decision.
3. **Done-when:** the lead drafts it, with no click.
4. **Capsule:** it is a fresh session's first prompt, and rotation stays out of this plan.
