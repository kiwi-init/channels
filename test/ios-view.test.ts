import { beforeAll, describe, expect, test } from "bun:test";

import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";

import { roomView } from "../ios/engine/view.ts";
import type { RoomView } from "../ios/engine/wire.ts";

const T0 = 1_700_000_000_000;
const ids: Record<string, Identity> = {};
let roster: Roster;

type Draft = Omit<Message, "seq" | "rts" | "sigOk" | "v" | "id" | "ts" | "pk" | "sig">;

async function signedLog(drafts: Draft[]): Promise<Message[]> {
  const out: Message[] = [];
  for (const [i, d] of drafts.entries()) {
    const ts = T0 + i * 60_000;
    const p = await sign(ids[d.from]!, { v: 1 as const, id: crypto.randomUUID(), ts, ...d });
    out.push({ ...p, seq: i + 1, rts: ts, sigOk: await verify(p) } as Message);
  }
  return out;
}

const say = (from: string, body: string, more: Partial<Draft> = {}): Draft => ({ from, kind: "msg", body, ...more });
const ev = (from: string, e: Event): Draft => ({ from, kind: "event", body: "", ev: e });

function view(log: Message[], me: string): RoomView {
  return roomView({
    code: "code",
    title: "channels-dev",
    icon: null,
    me,
    isOwner: me === "jow",
    connection: "live",
    gone: null,
    error: null,
    head: log.length,
    whole: true,
    messages: log,
    state: fold(log, roster, T0 + log.length * 60_000),
    online: new Map(),
    place: "main",
  });
}

beforeAll(async () => {
  for (const n of ["jow", "lead", "dev"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "lead", pk: ids.lead!.pk, owner: false, at: 0, active: true, kind: "agent", role: "lead" },
    { name: "dev", pk: ids.dev!.pk, owner: false, at: 0, active: true, kind: "agent" },
  ];
});

describe("the phone's room view", () => {
  let log: Message[];

  beforeAll(async () => {
    log = await signedLog([
      say("lead", "On it: T12 is mine."),
      ev("lead", { op: "task.add", title: "Gate the feel numbers in CI", owner: "dev", review: "*" }),
      ev("lead", { op: "task.add", title: "Panels slide over the page", owner: "dev", review: "lead" }),
      ev("dev", { op: "task.update", task: 2, state: "review", at: "abc123" }),
      ev("dev", { op: "task.update", task: 3, state: "review", at: "def456" }),
      say("dev", "T2 is green and waits for your OK.", { task: 2 }),
      say("lead", "Only for you.", { to: ["jow"], dm: true }),
    ]);
  });

  test("a task waiting on the person's review is in reviews, done by its owner; one for an agent reviewer isn't", () => {
    const reviews = view(log, "jow").reviews;
    expect(reviews.map((r) => [r.task, r.title, r.by])).toEqual([[2, "Gate the feel numbers in CI", "dev"]]);
    expect(reviews[0]!.at).toBe(T0 + 3 * 60_000);
  });

  test("an agent's seat gets no reviews", () => {
    expect(view(log, "dev").reviews).toEqual([]);
  });

  test("the channel's latest line is the newest message outside the lead chat, with the thread it was said in", () => {
    const room = view(log, "jow");
    expect(room.last?.body).toBe("On it: T12 is mine.");
    expect(room.latest?.body).toBe("T2 is green and waits for your OK.");
    expect(room.latestIn).toBe("task:2");
  });

  test("with nothing past #general, the latest line is #general's", async () => {
    const room = view(await signedLog([say("lead", "Board is up."), say("jow", "thanks")]), "jow");
    expect(room.latest?.body).toBe("thanks");
    expect(room.latestIn).toBe("main");
  });
});
