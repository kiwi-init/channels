import { describe, expect, test } from "bun:test"

import { sinceYouLeft } from "~/chat/since"
import type { Channel, Message, Room, Task, TaskStatus, Where } from "~/model"

const general: Where = { kind: "room", room: "general" }
const design: Where = { kind: "room", room: "design" }

const msg = (seq: number, from: string, text: string, where: Where, extra: Partial<Message> = {}): Message => ({ seq, from, at: seq * 60_000, text, where, ...extra })

const task = (id: number, status: TaskStatus, updatedAt: number): Task => ({ id, title: `task ${id}`, status, createdBy: "jow", createdAt: 0, updatedAt, notes: [], rounds: [] })

type Shape = Pick<Channel, "rooms" | "directs" | "theirs" | "messages" | "tasks">

function channel(over: Partial<Shape> = {}): Shape {
  const rooms: Room[] = [
    { id: "general", name: "general", unread: 3, mentions: 0, seen: 2 },
    { id: "design", name: "design", unread: 1, mentions: 0, seen: 4 },
  ]
  const messages = [
    msg(1, "jow", "old", general),
    msg(2, "nova", "older", general),
    msg(3, "nova", "release is out", general),
    msg(4, "kind-gecko", "PR up", general),
    msg(5, "nova", "shots for T1304", general),
    msg(6, "maya", "new palette", design),
    msg(7, "nova", "T1390 is yours", { kind: "theirs", between: ["happy-manatee", "nova"] }),
    msg(8, "happy-manatee", "on it", { kind: "theirs", between: ["happy-manatee", "nova"] }),
    msg(9, "harry", "photo works now", { kind: "dm", with: "harry" }),
  ]
  return {
    rooms,
    directs: [{ with: "harry", unread: 1, last: 9, seen: 1 }],
    theirs: [{ between: ["happy-manatee", "nova"], last: 8 }],
    messages,
    tasks: [task(1, "done", 4 * 60_000), task(2, "doing", 5 * 60_000), task(3, "waiting", 6 * 60_000), task(4, "done", 60_000)],
    ...over,
  }
}

describe("Since you left (T1605)", () => {
  test("starts at the oldest unread mark and sums what each place gained", () => {
    const s = sinceYouLeft(channel())!
    expect(s.seq).toBe(1)
    expect(s.at).toBe(2 * 60_000)
    expect(s.rooms.map((r) => [r.where, r.count, r.who])).toEqual([
      [general, 3, ["nova", "kind-gecko"]],
      [design, 1, ["maya"]],
    ])
    expect(s.rooms[0]!.last.text).toBe("shots for T1304")
  })

  test("your DMs and the DMs between others sit together, newest first", () => {
    const s = sinceYouLeft(channel())!
    expect(s.dms.map((d) => [d.where.kind, d.count])).toEqual([
      ["dm", 1],
      ["theirs", 2],
    ])
  })

  test("tasks that moved since then, by state; older moves stay out", () => {
    const s = sinceYouLeft(channel())!
    expect(s.tasks.done.map((t) => t.id)).toEqual([1])
    expect(s.tasks.doing.map((t) => t.id)).toEqual([2])
    expect(s.tasks.waiting.map((t) => t.id)).toEqual([3])
  })

  test("nothing unread, or only muted rooms, shows nothing", () => {
    expect(sinceYouLeft(channel({ rooms: [{ id: "general", name: "general", unread: 0, mentions: 0, seen: 5 }], directs: [] }))).toBeNull()
    expect(sinceYouLeft(channel({ rooms: [{ id: "design", name: "design", unread: 1, mentions: 0, seen: 4, muted: true }], directs: [] }))).toBeNull()
  })

  test("messages out of order still start at the oldest unseen one", () => {
    const c = channel()
    const s = sinceYouLeft({ ...c, messages: [...c.messages].reverse() })!
    expect(s.at).toBe(2 * 60_000)
    expect(s.rooms[0]!.last.text).toBe("shots for T1304")
  })

  test("pending, failed, deleted and system lines don't count", () => {
    const quiet = channel({
      rooms: [{ id: "general", name: "general", unread: 1, mentions: 0, seen: 9 }],
      directs: [],
      theirs: [],
      messages: [
        msg(10, "nova", "sending", general, { pending: true }),
        msg(11, "nova", "gone", general, { deleted: true }),
        msg(12, "jow", "joined", general, { system: true }),
        msg(13, "maya", "hi", general),
      ],
    })
    expect(sinceYouLeft(quiet)!.rooms[0]!.who).toEqual(["maya"])
  })
})
