import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts";

const ids: Record<string, Identity> = {};
let roster: Roster;
const log: Message[] = [];

async function post(from: string, body: string, ev?: Event): Promise<void> {
  const seq = log.length + 1;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: ev ? ("event" as const) : ("msg" as const), body, ...(ev ? { ev } : {}), ts: seq });
  log.push({ ...p, seq, rts: seq, sigOk: await verify(p) } as Message);
}

beforeAll(async () => {
  for (const n of ["jon", "bot"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human", sponsor: { user: "u-jon", name: "Jon", handle: "jon" } },
    { name: "bot", pk: ids.bot!.pk, owner: false, at: 1, active: true, kind: "agent" },
  ];
  for (let i = 0; i < 40; i++) await post("bot", "", { op: "task.add", title: `task ${i}` } as Event);
  await post("jon", "", { op: "fact.set", key: "relay", value: "v1" } as Event);
  for (let i = 0; i < 300; i++) await post(i % 2 ? "jon" : "bot", `message ${i}`);
});

describe("a window of recent messages, folded on the snapshot, sees the whole channel", () => {
  test("tasks and facts from before the window survive", () => {
    const whole = fold(log, roster, 10_000);
    let base: FoldBase | null = null;
    fold(log.slice(0, 200), roster, 10_000, null, null, null, (b) => (base = b));
    const window = log.slice(150);
    const alone = fold(window, roster, 10_000);
    const onBase = fold(window, roster, 10_000, null, null, base);
    expect(alone.tasks.size).toBe(0);
    expect(onBase.tasks.size).toBe(40);
    expect([...onBase.tasks.values()].map((t) => t.title)).toEqual([...whole.tasks.values()].map((t) => t.title));
    expect(onBase.facts.get("relay")?.value).toBe("v1");
    expect(onBase.head).toBe(whole.head);
  });
});
