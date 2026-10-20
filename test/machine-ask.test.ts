import { beforeAll, describe, expect, test } from "bun:test";
import { openFrom, sealTo } from "@kiwi/core/crypto.ts";
import { generateIdentity, sign, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { ASK_FRESH_MS, ASK_MAX_BYTES, makeAsk, readAnswer, readAsk, signAnswer } from "@kiwi/core/machine-ask.ts";
import { newSecret } from "@kiwi/core/mailbox.ts";

let person: Identity;
let stranger: Identity;
let machine: Identity;
let other: Identity;
const to = (m: Identity) => ({ pk: m.pk, xpk: m.xpk! });

beforeAll(async () => {
  person = await withExchangeKey(await generateIdentity("person"));
  stranger = await withExchangeKey(await generateIdentity("stranger"));
  machine = await withExchangeKey(await generateIdentity("machine"));
  other = await withExchangeKey(await generateIdentity("other machine"));
});

describe("an ask to a paired computer", () => {
  test("is read back by that computer, from that person, while fresh and new", async () => {
    const reply = newSecret();
    const { box, id } = await makeAsk(person, to(machine), { verb: "launch", args: { harness: "claude", folder: "/work" }, reply, id: "launch_0123456789" }, 1_000_000);
    expect(id).toBe("launch_0123456789");
    expect(box.length).toBeLessThanOrEqual(ASK_MAX_BYTES);
    expect(await readAsk(machine, box, { person: person.pk, now: 1_000_000 + ASK_FRESH_MS })).toEqual({
      ok: true,
      ask: { kind: "kiwi-machine-ask", v: 1, machine: machine.pk, verb: "launch", args: { harness: "claude", folder: "/work" }, id: "launch_0123456789", at: 1_000_000, reply },
    });
  });

  test("is refused when it's for another computer, from someone else, old, from the future, or seen before", async () => {
    const reply = newSecret();
    const { box, id } = await makeAsk(person, to(machine), { verb: "harnesses", args: {}, reply }, 1_000_000);
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await readAsk(other, box, { person: person.pk, now: 1_000_000 })).toEqual({ ok: false, why: "unsealed" });
    expect(await readAsk(machine, box, { person: stranger.pk, now: 1_000_000 })).toEqual({ ok: false, why: "not-yours" });
    expect(await readAsk(machine, box, { person: person.pk, now: 1_000_000 + ASK_FRESH_MS + 1 })).toEqual({ ok: false, why: "stale" });
    expect(await readAsk(machine, box, { person: person.pk, now: 1_000_000 - ASK_FRESH_MS - 1 })).toEqual({ ok: false, why: "stale" });
    expect(await readAsk(machine, box, { person: person.pk, now: 1_000_000, seen: () => true })).toEqual({ ok: false, why: "replayed" });
  });

  test("sealed to this computer but meant for another one is refused, so a box can't be re-aimed", async () => {
    const reply = newSecret();
    const signed = await sign(person, { kind: "kiwi-machine-ask", v: 1, machine: other.pk, verb: "launch", args: {}, id: "aimedElsewhere1", at: 5, reply });
    const box = await sealTo(machine.xpk!, JSON.stringify(signed), "kiwi-machine-ask");
    expect(await readAsk(machine, box, { person: person.pk, now: 5 })).toEqual({ ok: false, why: "not-yours" });
  });

  test("anything changed inside, an unknown verb, an extra field, or a forged signature is refused", async () => {
    const reply = newSecret();
    const reseal = (x: object) => sealTo(machine.xpk!, JSON.stringify(x), "kiwi-machine-ask");
    const good = await sign(person, { kind: "kiwi-machine-ask", v: 1, machine: machine.pk, verb: "folders", args: {}, id: "foldersAsk_01", at: 5, reply });
    expect((await readAsk(machine, await reseal(good), { person: person.pk, now: 5 })).ok).toBe(true);
    expect(await readAsk(machine, await reseal({ ...good, verb: "launch" }), { person: person.pk, now: 5 })).toEqual({ ok: false, why: "unsigned" });
    expect(await readAsk(machine, await reseal({ ...good, verb: "rm" }), { person: person.pk, now: 5 })).toEqual({ ok: false, why: "malformed" });
    expect(await readAsk(machine, await reseal({ ...good, argv: ["sh"] }), { person: person.pk, now: 5 })).toEqual({ ok: false, why: "malformed" });
    expect(await readAsk(machine, await reseal({ ...good, sig: good.sig.replace(/^./, (c) => (c === "A" ? "B" : "A")) }), { person: person.pk, now: 5 })).toEqual({
      ok: false,
      why: "unsigned",
    });
    expect(await readAsk(machine, "not.a.box", { person: person.pk, now: 5 })).toEqual({ ok: false, why: "unsealed" });
    expect(await readAsk(machine, "x".repeat(ASK_MAX_BYTES + 1), { person: person.pk, now: 5 })).toEqual({ ok: false, why: "too-big" });
  });

  test("a bad id or reply, or one too big once sealed, isn't made at all", async () => {
    await expect(makeAsk(person, to(machine), { verb: "harnesses", args: {}, reply: "short" })).rejects.toThrow("mailbox secret");
    await expect(makeAsk(person, to(machine), { verb: "harnesses", args: {}, reply: newSecret(), id: "no spaces" })).rejects.toThrow("id");
    await expect(makeAsk(person, to(machine), { verb: "launch", args: { blob: "x".repeat(ASK_MAX_BYTES) }, reply: newSecret() })).rejects.toThrow("at most");
  });

  test("an ask can be opened only with this computer's own key, and the relay only sees the box", async () => {
    const { box } = await makeAsk(person, to(machine), { verb: "unpair", args: {}, reply: newSecret() });
    expect(box).not.toContain(person.pk);
    expect(await openFrom(other.xsk!, box, "kiwi-machine-ask")).toBeNull();
    expect(await openFrom(machine.xsk!, box, "mc/box")).toBeNull();
  });
});

describe("a paired computer's answer", () => {
  test("is read only when signed by that computer, for that ask", async () => {
    const answer = await signAnswer(machine, "launch_0123456789", { ok: true, launch: "launch_0123456789" });
    expect(await readAnswer(answer, { machine: machine.pk, id: "launch_0123456789" })).toEqual({ result: { ok: true, launch: "launch_0123456789" } });
    expect(await readAnswer(answer, { machine: other.pk, id: "launch_0123456789" })).toBeNull();
    expect(await readAnswer(answer, { machine: machine.pk, id: "another_ask_id1" })).toBeNull();
    expect(await readAnswer({ ...answer, result: { ok: false } }, { machine: machine.pk, id: "launch_0123456789" })).toBeNull();
    expect(await readAnswer({ ...answer, extra: 1 }, { machine: machine.pk, id: "launch_0123456789" })).toBeNull();
    expect(await readAnswer(await signAnswer(other, "launch_0123456789", {}), { machine: machine.pk, id: "launch_0123456789" })).toBeNull();
    expect(await readAnswer("nope", { machine: machine.pk, id: "launch_0123456789" })).toBeNull();
  });
});
