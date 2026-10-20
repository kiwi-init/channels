import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { readAsk, signAnswer } from "@kiwi/core/machine-ask.ts";
import { openMailbox } from "@kiwi/core/mailbox.ts";
import { askMachine, machineOnline, NO_ANSWER } from "../desktop/src/remote.ts";

const RELAY = "https://relay.test";

let person: Identity;
let machine: Identity;
let stranger: Identity;

beforeAll(async () => {
  person = await withExchangeKey(await generateIdentity("person"));
  machine = await withExchangeKey(await generateIdentity("machine"));
  stranger = await withExchangeKey(await generateIdentity("stranger"));
});

type Answering = (ask: { verb: string; args: Record<string, unknown>; id: string }) => { by: Identity; result: unknown } | null;

function fakeRelay(opts: { inbox?: number; answer?: Answering; online?: boolean } = {}) {
  const slots = new Map<string, string>();
  const asked: { verb: string; id: string }[] = [];
  const relayFetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const inbox = /^\/v1\/machine\/([^/]+)\/inbox$/.exec(url.pathname);
    if (inbox && method === "POST") {
      if (opts.inbox && opts.inbox !== 202) return new Response(null, { status: opts.inbox });
      const { box } = JSON.parse(String(init?.body)) as { box: string };
      setTimeout(() => void answer(box), 5);
      return new Response(null, { status: 202 });
    }
    if (/^\/v1\/machine\/[^/]+$/.test(url.pathname)) return opts.online === undefined ? new Response(null, { status: 403 }) : Response.json({ online: opts.online });
    const slot = /^\/v1\/mailbox\/([^/]+)\/(a|b)$/.exec(url.pathname);
    if (slot) {
      const key = `${slot[1]}/${slot[2]}`;
      if (method === "PUT") {
        slots.set(key, String(init?.body));
        return new Response(null, { status: 204 });
      }
      const held = slots.get(key);
      return held ? new Response(held, { headers: { "content-type": "application/json" } }) : new Response(null, { status: 404 });
    }
    if (/^\/v1\/mailbox\/[^/]+$/.test(url.pathname) && method === "DELETE") return new Response(null, { status: 204 });
    return new Response(null, { status: 500 });
  }) as typeof fetch;
  const answer = async (box: string) => {
    const read = await readAsk(machine, box, { person: person.pk, claim: () => true });
    if (!read.ok) return;
    asked.push({ verb: read.ask.verb, id: read.ask.id });
    const said = opts.answer?.({ verb: read.ask.verb, args: read.ask.args, id: read.ask.id });
    if (!said) return;
    const mailbox = await openMailbox(RELAY, read.ask.reply, relayFetch);
    await mailbox.put("b", await signAnswer(said.by, read.ask.id, said.result));
  };
  return { relayFetch, asked };
}

const to = () => ({ pk: machine.pk, xpk: machine.xpk! });

describe("asking another computer through the relay", () => {
  test("its signed answer comes back, and a launch's id is the one the app chose", async () => {
    const relay = fakeRelay({
      answer: ({ verb }) => ({ by: machine, result: verb === "harnesses" ? { ok: true, harnesses: [] } : { ok: true, launch: "launch-app-chose", placed: { ok: true, place: "terminal" } } }),
    });
    const asker = { person, relay: RELAY, fetch: relay.relayFetch };
    expect(await askMachine(asker, to(), "harnesses", {}, { timeoutMs: 2_000 })).toEqual({ ok: true, result: { ok: true, harnesses: [] } });
    const launched = await askMachine(asker, to(), "launch", { harness: "claude", folder: "/srv/app", code: "mc2-x" }, { timeoutMs: 2_000, id: "launch-app-chose" });
    expect(launched.ok).toBe(true);
    expect(relay.asked.at(-1)).toEqual({ verb: "launch", id: "launch-app-chose" });
  });

  test("an answer signed by anyone but that computer is refused", async () => {
    const relay = fakeRelay({ answer: () => ({ by: stranger, result: { ok: true, harnesses: [] } }) });
    expect(await askMachine({ person, relay: RELAY, fetch: relay.relayFetch }, to(), "harnesses", {}, { timeoutMs: 2_000 })).toEqual({
      ok: false,
      why: "failed",
      detail: "the answer wasn't signed by that computer",
    });
  });

  test("no answer in time says why it might be, and the relay's refusals say what they mean", async () => {
    const silent = fakeRelay({ answer: () => null });
    expect(await askMachine({ person, relay: RELAY, fetch: silent.relayFetch }, to(), "folders", {}, { timeoutMs: 50 })).toEqual({ ok: false, why: "no-answer", detail: NO_ANSWER });
    expect(await askMachine({ person, relay: RELAY, fetch: fakeRelay({ inbox: 403 }).relayFetch }, to(), "harnesses", {}, { timeoutMs: 50 })).toMatchObject({ ok: false, why: "not-registered" });
    expect(await askMachine({ person, relay: RELAY, fetch: fakeRelay({ inbox: 429 }).relayFetch }, to(), "harnesses", {}, { timeoutMs: 50 })).toMatchObject({ ok: false, why: "busy" });
  });

  test("online is the relay's word, and anything else is unknown rather than offline", async () => {
    expect(await machineOnline({ person, relay: RELAY, fetch: fakeRelay({ online: true }).relayFetch }, machine.pk)).toBe(true);
    expect(await machineOnline({ person, relay: RELAY, fetch: fakeRelay({ online: false }).relayFetch }, machine.pk)).toBe(false);
    expect(await machineOnline({ person, relay: RELAY, fetch: fakeRelay().relayFetch }, machine.pk)).toBeNull();
  });
});
