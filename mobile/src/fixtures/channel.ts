import { PROTOCOL_VERSION, type Event, type Kind, type Message } from "@mc/protocol.ts"
import type { Roster } from "@mc/state.ts"

const T0 = Date.UTC(2026, 9, 16, 12, 0, 0)

const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/VscvDQAAAABJRU5ErkJggg=="

export const fixtureRoster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: T0, active: true, kind: "human", display: "Jow" },
  { name: "coordinator", pk: "pk-coordinator", owner: false, at: T0 + 1000, active: true, kind: "agent", role: "coordinator" },
  { name: "merge-bus", pk: "pk-bus", owner: false, at: T0 + 2000, active: true, kind: "agent", role: "merges branches" },
  { name: "kiwi-browser", pk: "pk-browser", owner: false, at: T0 + 3000, active: true, kind: "agent" },
]

export const SELF = "jow"

function pkOf(name: string): string {
  return fixtureRoster.find((r) => r.name === name)?.pk ?? `pk-${name}`
}

const TASK = 7

let seq = 0

function message(from: string, kind: Kind, body: string, extra: Partial<Message> = {}): Message {
  seq += 1
  return { v: PROTOCOL_VERSION, id: `fixture-${seq}`, from, kind, body, ts: T0 + seq * 60_000, rts: T0 + seq * 60_000, seq, sigOk: true, pk: pkOf(from), ...extra }
}

function event(from: string, ev: Event, body: string, extra: Partial<Message> = {}): Message {
  return message(from, "event", body, { ev, ...extra })
}

export const fixtureMessages: Message[] = [
  event("jow", { op: "hello", role: "owner" }, "jow joined"),
  event("coordinator", { op: "hello", role: "coordinator" }, "coordinator joined"),
  message("jow", "msg", "Morning. What is on the board today?"),
  message("coordinator", "msg", "Three things: the mobile skeleton, the release, and two flaky tests.", { re: [3] }),
  message("coordinator", "ask", "Should the release wait for the GIF reactions?", { to: ["jow"] }),
  message("jow", "ack", "Yes, wait for them.", { re: [5] }),
  event("coordinator", { op: "task.add", title: "Mobile: Expo app", detail: "Same quality as the desktop app", owner: "merge-bus" }, "task 7: Mobile: Expo app"),
  event("merge-bus", { op: "task.claim", task: TASK }, "merge-bus took task 7", { task: TASK }),
  message("merge-bus", "status", "Skeleton is up, starting the shared code spike.", { task: TASK }),
  message("merge-bus", "msg", "Tokens come from index.css, not DESIGN.md.", { task: TASK, re: [9] }),
  event("merge-bus", { op: "task.update", task: TASK, state: "doing", note: "tokens and fixtures" }, "task 7 is doing", { task: TASK }),
  message("kiwi-browser", "blocking", "I need the relay interface before I can start the screens.", { task: TASK, to: ["merge-bus"] }),
  message("merge-bus", "done", "Interface is in #534.", { task: TASK, re: [12] }),
  message("kiwi-browser", "msg", "Sending you the design for the composer.", {
    room: "design",
    imgs: [{ name: "composer.png", mime: "image/png", data: PIXEL }],
  }),
  message("jow", "msg", "Only you two for now.", { dm: true, to: ["merge-bus"] }),
  message("merge-bus", "blocking", "Needs a person: which Apple team signs the dev build?", {
    esc: true,
    to: ["jow"],
    handoff: { url: "https://example.com/handoff/abc", vendor: "example", expiresAt: T0 + 3_600_000, mode: "tab" },
  }),
  event("jow", { op: "react", seq: 15, emoji: "👍" }, "reaction", { to: [] }),
  event("jow", { op: "react", seq: 15, emoji: "ok/thumbs-up" }, "reaction", { to: [] }),
  event("jow", { op: "fact.set", key: "branch", value: "mobile" }, "branch = mobile"),
  event("jow", { op: "room.create", id: "design", name: "design" }, "room design created"),
  message("coordinator", "done", "Release 0.16.0 is out.", { re: [5] }),
]

export const fixtureKinds: Kind[] = ["msg", "ask", "blocking", "ack", "status", "done", "event"]
