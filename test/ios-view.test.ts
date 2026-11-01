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
      ev("lead", { op: "task.add", title: "Gate the feel numbers in CI", owner: "dev", review: "jow" }),
      ev("lead", { op: "task.add", title: "Panels slide over the page", owner: "dev", review: "lead" }),
      ev("dev", { op: "task.update", task: 2, state: "review", at: "abc123" }),
      ev("dev", { op: "task.update", task: 3, state: "review", at: "def456" }),
      ev("lead", { op: "task.add", title: "Open to any reviewer", owner: "dev", review: "*" }),
      ev("dev", { op: "task.update", task: 6, state: "review", at: "ghi789" }),
      say("dev", "T2 is green and waits for your OK.", { task: 2 }),
      say("lead", "Only for you.", { to: ["jow"], dm: true }),
    ]);
  });

  test("only a review naming the person is in reviews, done by its owner; agent and any-reviewer tasks aren't", () => {
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

describe("names in the phone's room view (#1251)", () => {
  const named = (log: Message[], nick = "Earnest Heron"): RoomView => {
    const people: Roster = roster.map((r) => (r.name === "dev" ? { ...r, display: nick } : r));
    return roomView({
      code: "code",
      title: "channels-dev",
      icon: null,
      me: "jow",
      isOwner: true,
      connection: "live",
      gone: null,
      error: null,
      head: log.length,
      whole: true,
      messages: log,
      state: fold(log, people, T0 + log.length * 60_000),
      online: new Map(),
      place: "main",
    });
  };

  test("a message shows an @handle as the nickname and keeps its text as sent; code keeps the handle", async () => {
    const room = named(await signedLog([say("lead", "In review with @dev, see `@dev` and\n\n```\n@dev\n```"), say("dev", "on it"), say("jow", "ok", { re: [1] }), say("jow", "@dev thanks")]));
    expect(room.messages[0]).toMatchObject({ body: "In review with @dev, see `@dev` and\n\n```\n@dev\n```", shown: "In review with @Earnest Heron, see `@dev` and\n\n```\n@dev\n```" });
    expect(room.messages[2]?.quote?.words).toBe("In review with @Earnest Heron, see `@dev` and ``` @dev ```");
    expect(room.latest).toMatchObject({ body: "@dev thanks", shown: "@Earnest Heron thanks", plain: "@Earnest Heron thanks" });
  });

  test("a nickname is shown as text, never as Markdown", async () => {
    const room = named(await signedLog([say("lead", "Ping @dev")]), "Earnest _Heron_ *1*");
    expect(room.messages[0]).toMatchObject({ body: "Ping @dev", shown: "Ping @Earnest \\_Heron\\_ \\*1\\*", plain: "Ping @Earnest _Heron_ *1*" });
  });

  test("a nickname a bare handle turns into can't start a Markdown block", async () => {
    const people: Roster = roster.map((r) => (r.name === "dev" ? { ...r, name: "dev.bot", display: "# Heron" } : r));
    const log = await signedLog([say("lead", "dev.bot says hello\n\n@dev.bot then")]);
    const room = roomView({
      code: "code",
      title: "c",
      icon: null,
      me: "jow",
      isOwner: true,
      connection: "live",
      gone: null,
      error: null,
      head: 1,
      whole: true,
      messages: log,
      state: fold(log, people, T0 + 60_000),
      online: new Map(),
      place: "main",
    });
    expect(room.messages[0]).toMatchObject({ shown: "\\# Heron says hello\n\n@\\# Heron then", plain: "# Heron says hello\n\n@# Heron then" });
  });

  test("an ask shows the nickname, while its choices and the answer that picks one keep their text, which the phone sends back and matches", async () => {
    const room = named(await signedLog([say("lead", "Who takes it, @dev?", { kind: "ask", to: ["jow"], choices: ["@dev", "nobody"] }), say("jow", "@dev", { re: [1] })]));
    expect(room.messages[0]).toMatchObject({ shown: "Who takes it, @Earnest Heron?", choices: ["@dev", "nobody"], chosen: { choice: "@dev", by: "jow" } });
    expect(room.messages[1]?.body).toBe("@dev");
    const open = named(await signedLog([ev("jow", { op: "task.add", title: "ship it", owner: "lead" }), say("lead", "Ping @dev?", { kind: "ask", to: ["jow"], choices: ["yes"], holds: [1] })]));
    expect(open.asks[0]).toMatchObject({ body: "Ping @dev?", shown: "Ping @Earnest Heron?", plain: "Ping @Earnest Heron?", choices: ["yes"] });
  });

  test("a named room's messages stay out of #general (T948)", async () => {
    const log = await signedLog([ev("jow", { op: "room.create", id: "ops", name: "ops" }), say("jow", "for everyone"), say("jow", "only for ops", { room: "ops" })]);
    const bodies = view(log, "jow").messages.map((m) => m.body);
    expect(bodies).toContain("for everyone");
    expect(bodies).not.toContain("only for ops");
  });
});
