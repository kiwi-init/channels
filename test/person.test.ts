// A person's key and what it signs (src/person.ts), and pairing through a mailbox (src/mailbox.ts),
// against an in-memory mailbox that behaves like the relay's: write-once slots, 404 when empty.

import { describe, expect, test } from "bun:test";
import { generateIdentity } from "../src/identity.ts";
import { answerPair, askToPair, mailboxId, newSecret, openMailbox, pairCode, readPairAnswer, readPairAsk, readPairCode, type PairAsk } from "../src/mailbox.ts";
import { certifyMachine, checkComputer, checkPerson, claimComputer, provePerson, readMachineCert } from "../src/person.ts";

const ROOM = "0123456789abcdef0123456789abcdef";

/** A relay's mailbox routes, in memory. `boxes` is exposed so a test can play the relay tampering. */
function fakeRelay() {
  const boxes = new Map<string, string>();
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const m = /^\/v1\/mailbox\/([A-Za-z0-9_-]{43})(?:\/([ab]))?$/.exec(url.pathname);
    if (!m) return new Response("{}", { status: 404 });
    const [, id, slot] = m;
    const key = `${id}/${slot}`;
    const method = init?.method ?? "GET";
    if (method === "DELETE") {
      for (const s of ["a", "b"]) boxes.delete(`${id}/${s}`);
      return new Response(null, { status: 204 });
    }
    if (method === "PUT") {
      if (boxes.has(key)) return Response.json({ error: "already written" }, { status: 409 });
      boxes.set(key, (JSON.parse(String(init?.body)) as { box: string }).box);
      return new Response(null, { status: 204 });
    }
    const box = boxes.get(key);
    return box ? Response.json({ box }) : Response.json({ error: "empty" }, { status: 404 });
  }) as typeof fetch;
  return { boxes, fetchImpl, relay: "http://relay.test" };
}

describe("machine certs and claims", () => {
  test("a computer's claim names its person, for that agent in that channel only", async () => {
    const person = await generateIdentity("Ada Lovelace");
    const machine = await generateIdentity("vps-1");
    const agent = await generateIdentity("claude");
    const cert = await certifyMachine(person, { pk: machine.pk, xpk: machine.xpk!, label: "vps-1" });
    expect(await readMachineCert(cert)).toEqual(cert);
    const claim = await claimComputer(machine, cert, ROOM, agent.pk);
    expect((await checkComputer(claim, ROOM, agent.pk))?.pk).toBe(person.pk);
    // Replayed for another agent, or into another channel: no.
    const other = await generateIdentity("codex");
    expect(await checkComputer(claim, ROOM, other.pk)).toBeNull();
    expect(await checkComputer(claim, ROOM.replace("0", "f"), agent.pk)).toBeNull();
  });

  test("a cert someone else signed, or one with a field changed or added, doesn't count", async () => {
    const person = await generateIdentity("Ada");
    const mallory = await generateIdentity("Mallory");
    const machine = await generateIdentity("vps-1");
    const agent = await generateIdentity("claude");
    const cert = await certifyMachine(person, { pk: machine.pk, xpk: machine.xpk!, label: "vps-1" });
    expect(await readMachineCert({ ...cert, label: "mac-mini" })).toBeNull();
    expect(await readMachineCert({ ...cert, pk: mallory.pk })).toBeNull();
    expect(await readMachineCert({ ...cert, extra: 1 })).toBeNull();
    // A computer can't vouch with a cert made out to another computer.
    const theirs = await certifyMachine(person, { pk: (await generateIdentity("x")).pk, xpk: machine.xpk!, label: "x" });
    await expect(claimComputer(machine, theirs, ROOM, agent.pk)).rejects.toThrow();
    // Nor sign with its own key under someone else's cert.
    const forged = { cert: theirs, vouch: (await claimComputer(machine, cert, ROOM, agent.pk)).vouch };
    expect(await checkComputer(forged, ROOM, agent.pk)).toBeNull();
  });

  test("a person claim proves the person key signed this member key", async () => {
    const person = await generateIdentity("Ada");
    const member = await generateIdentity("ada");
    const claim = await provePerson(person, ROOM, member.pk);
    expect(await checkPerson(claim, ROOM, member.pk)).toBe(person.pk);
    // Claiming someone else's person key without their signature: no.
    const mallory = await generateIdentity("mallory");
    expect(await checkPerson({ person: person.pk, proof: claim.proof }, ROOM, mallory.pk)).toBeNull();
    expect(await checkPerson({ ...claim, person: mallory.pk }, ROOM, member.pk)).toBeNull();
  });
});

describe("pairing through a mailbox", () => {
  test("the app's code pairs the computer, and each side checks the other", async () => {
    const { fetchImpl, relay } = fakeRelay();
    const person = await generateIdentity("Ada Lovelace");
    const machine = await generateIdentity("vps-1");
    const secret = newSecret();
    const code = pairCode(secret);
    expect(readPairCode(code)).toBe(secret);
    expect(readPairCode("kp1-short")).toBeNull();

    // The computer, from `kiwi pair <code>`.
    const there = await openMailbox(relay, readPairCode(code)!, fetchImpl);
    await askToPair(machine, there, "vps-1", "linux");
    // The app.
    const here = await openMailbox(relay, secret, fetchImpl);
    expect(here.id).toBe(await mailboxId(secret));
    const ask = await readPairAsk(await here.get("a"), here);
    expect(ask?.pk).toBe(machine.pk);
    expect(ask?.label).toBe("vps-1");
    const cert = await answerPair(person, here, ask!);
    // Back on the computer.
    const answer = await readPairAnswer(await there.wait("b", { timeoutMs: 1_000 }), machine.pk);
    expect(answer?.cert).toEqual(cert);
    expect(answer?.person).toEqual({ pk: person.pk, xpk: person.xpk!, name: "Ada Lovelace" });
    await there.drop();
    expect(await here.get("a")).toBeNull();
  });

  test("a relay can't read, swap or replay what's in a mailbox", async () => {
    const { boxes, fetchImpl, relay } = fakeRelay();
    const machine = await generateIdentity("vps-1");
    const secret = newSecret();
    const mb = await openMailbox(relay, secret, fetchImpl);
    await askToPair(machine, mb, "vps-1", "linux");
    const sealed = boxes.get(`${mb.id}/a`)!;
    expect(sealed).not.toContain(machine.pk);
    // Slot a's box moved into slot b doesn't open there.
    boxes.set(`${mb.id}/b`, sealed);
    await expect(mb.get("b")).rejects.toThrow(/didn't seal/);
    // Another mailbox's box doesn't open here either, and an ask signed for another mailbox is refused.
    const other = await openMailbox(relay, newSecret(), fetchImpl);
    await askToPair(machine, other, "vps-1", "linux");
    boxes.set(`${mb.id}/a`, boxes.get(`${other.id}/a`)!);
    await expect(mb.get("a")).rejects.toThrow(/didn't seal/);
    const ask = (await other.get<PairAsk>("a"))!;
    expect(await readPairAsk(ask, mb)).toBeNull();
    // An answer whose cert is for another computer is refused by the computer.
    const person = await generateIdentity("Ada");
    const fresh = await openMailbox(relay, newSecret(), fetchImpl);
    await askToPair(machine, fresh, "vps-1", "linux");
    await answerPair(person, fresh, (await readPairAsk(await fresh.get("a"), fresh))!);
    expect(await readPairAnswer(await fresh.get("b"), (await generateIdentity("y")).pk)).toBeNull();
  });

  test("a slot is written once", async () => {
    const { fetchImpl, relay } = fakeRelay();
    const mb = await openMailbox(relay, newSecret(), fetchImpl);
    await mb.put("a", { n: 1 });
    await expect(mb.put("a", { n: 2 })).rejects.toThrow(/already written/);
    expect(await mb.get<{ n: number }>("a")).toEqual({ n: 1 });
  });
});
