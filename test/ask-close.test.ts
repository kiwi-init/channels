import { beforeAll, describe, expect, test } from "bun:test";
import { describeEvent } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";

const ids: Record<string, Identity> = {};
const roster: Roster = [];
let seq = 0;
async function send(from: string, extra: Partial<Message>): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind: "chat" as Message["kind"], body: "", ts: seq, ...extra };
  const p = await sign(ids[from]!, base);
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}
const ask = (from: string, body: string) => send(from, { kind: "blocking", body, esc: true, to: ["jow"] });
const close = (from: string, n: number, why?: string) => send(from, { kind: "event", body: `closed #${n}`, ev: { op: "ask.close", ask: n, ...(why ? { why } : {}) } satisfies Event, re: [n] });
const open = (ms: Message[]) => fold(ms, roster).openAsks.map((m) => m.seq);

beforeAll(async () => {
  for (const [name, kind, owner] of [
    ["jow", "human", true],
    ["ana", "human", false],
    ["patient-otter", "agent", false],
    ["honest-wren", "agent", false],
  ] as const) {
    ids[name] = await generateIdentity(name);
    roster.push({ name, pk: ids[name]!.pk, owner, at: roster.length, active: true, kind });
  }
});

describe("an agent closes its own ask once the answer came some other way (#1128)", () => {
  test("the asker closes it, and it leaves what waits on people", async () => {
    const q = await ask("patient-otter", "Plan A or plan B?");
    expect(open([q])).toEqual([q.seq]);
    expect(open([q, await close("patient-otter", q.seq, "jow said brainstorm first")])).toEqual([]);
  });

  test("another agent can't close it; a person can", async () => {
    const q = await ask("patient-otter", "Ship it?");
    const other = await close("honest-wren", q.seq);
    const folded = fold([q, other], roster);
    expect(folded.openAsks.map((m) => m.seq)).toEqual([q.seq]);
    expect(folded.rejected.get(other.seq)).toBe("only who asked, or a person, closes an ask");
    expect(open([q, await close("ana", q.seq)])).toEqual([]);
  });

  test("only questions and steps close this way, not chat or a permission prompt", async () => {
    const chat = await send("patient-otter", { body: "hello" });
    const shut = await close("patient-otter", chat.seq);
    expect(fold([chat, shut], roster).rejected.get(shut.seq)).toBe(`#${chat.seq} isn't a question or a step waiting on someone`);
  });

  test("the feed says who closed it and why", async () => {
    expect(describeEvent(await close("patient-otter", 12, "answered in chat"))).toBe("closed #12: answered in chat");
    expect(describeEvent(await close("patient-otter", 12))).toBe("closed #12");
  });
});
