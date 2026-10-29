import { beforeAll, describe, expect, test } from "bun:test";
import type { ComputerSettings } from "@kiwi/core/computer-settings.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { readAsk, signAnswer } from "@kiwi/core/machine-ask.ts";
import { openMailbox } from "@kiwi/core/mailbox.ts";
import { askMachine, machineOnline, NO_ANSWER, personMachines, settingsOn } from "../desktop/src/remote.ts";

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
    const asker = { signer: person, person: person.pk, relay: RELAY, fetch: relay.relayFetch };
    expect(await askMachine(asker, to(), "harnesses", {}, { timeoutMs: 2_000 })).toEqual({ ok: true, result: { ok: true, harnesses: [] } });
    const launched = await askMachine(asker, to(), "launch", { harness: "claude", folder: "/srv/app", code: "mc2-x" }, { timeoutMs: 2_000, id: "launch-app-chose" });
    expect(launched.ok).toBe(true);
    expect(relay.asked.at(-1)).toEqual({ verb: "launch", id: "launch-app-chose" });
  });

  test("an answer signed by anyone but that computer is refused", async () => {
    const relay = fakeRelay({ answer: () => ({ by: stranger, result: { ok: true, harnesses: [] } }) });
    expect(await askMachine({ signer: person, person: person.pk, relay: RELAY, fetch: relay.relayFetch }, to(), "harnesses", {}, { timeoutMs: 2_000 })).toEqual({
      ok: false,
      why: "failed",
      detail: "the answer wasn't signed by that computer",
    });
  });

  test("no answer in time says why it might be, and the relay's refusals say what they mean", async () => {
    const silent = fakeRelay({ answer: () => null });
    expect(await askMachine({ signer: person, person: person.pk, relay: RELAY, fetch: silent.relayFetch }, to(), "folders", {}, { timeoutMs: 50 })).toEqual({
      ok: false,
      why: "no-answer",
      detail: NO_ANSWER,
    });
    expect(await askMachine({ signer: person, person: person.pk, relay: RELAY, fetch: fakeRelay({ inbox: 403 }).relayFetch }, to(), "harnesses", {}, { timeoutMs: 50 })).toMatchObject({
      ok: false,
      why: "not-registered",
    });
    expect(await askMachine({ signer: person, person: person.pk, relay: RELAY, fetch: fakeRelay({ inbox: 429 }).relayFetch }, to(), "harnesses", {}, { timeoutMs: 50 })).toMatchObject({
      ok: false,
      why: "busy",
    });
  });

  test("online is the relay's word, and anything else is unknown rather than offline", async () => {
    expect(await machineOnline({ signer: person, person: person.pk, relay: RELAY, fetch: fakeRelay({ online: true }).relayFetch }, machine.pk)).toBe(true);
    expect(await machineOnline({ signer: person, person: person.pk, relay: RELAY, fetch: fakeRelay({ online: false }).relayFetch }, machine.pk)).toBe(false);
    expect(await machineOnline({ signer: person, person: person.pk, relay: RELAY, fetch: fakeRelay().relayFetch }, machine.pk)).toBeNull();
  });
});

describe("listing a person's paired computers through the relay", () => {
  const listing = (status: number, body: unknown) =>
    (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const auth = new Headers(init?.headers).get("authorization");
      if (url.pathname !== `/v1/person/${person.pk}/machines` || !auth?.startsWith("Bearer ")) return new Response(null, { status: 500 });
      return status === 200 ? Response.json(body) : new Response(null, { status });
    }) as typeof fetch;

  test("signed by the person for their own path, it keeps only well-formed computers", async () => {
    const studio = { key: machine.pk, xpk: machine.xpk!, label: "studio", online: true, since: 5, seenAt: 4 };
    const asleep = { key: stranger.pk, xpk: stranger.xpk!, label: "", online: false, since: 9, seenAt: 3 };
    const got = await personMachines({
      signer: person,
      person: person.pk,
      relay: RELAY,
      fetch: listing(200, { machines: [studio, asleep, { key: "x" }, null, { ...studio, label: "y".repeat(65) }] }),
    });
    expect(got).toEqual({ ok: true, value: [studio, { key: stranger.pk, xpk: stranger.xpk!, label: "", online: false, seenAt: 3 }] });
  });

  test("a relay without the route says it needs an update; other answers say what they were", async () => {
    expect(await personMachines({ signer: person, person: person.pk, relay: RELAY, fetch: listing(404, null) })).toEqual({
      ok: false,
      detail: "This relay can't list your computers yet: it needs an update.",
    });
    expect(await personMachines({ signer: person, person: person.pk, relay: RELAY, fetch: listing(403, null) })).toEqual({ ok: false, detail: "the relay answered 403" });
    expect(await personMachines({ signer: person, person: person.pk, relay: RELAY, fetch: listing(200, { computers: [] }) })).toEqual({
      ok: false,
      detail: "the relay answered in a shape this app doesn't know",
    });
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await personMachines({ signer: person, person: person.pk, relay: RELAY, fetch: down })).toEqual({ ok: false, detail: "couldn't reach the relay: offline" });
  });
});

describe("reading another computer's settings", () => {
  test("is a settings ask with nothing in it, and only an answer in the settings' own shape reads back", async () => {
    const settings: ComputerSettings = {
      launch: "on",
      bypass: "off",
      hooks: [{ harness: "claude", state: "installed", text: "installed" }],
      seats: [{ channel: "dev", agent: "otter", wake: "on" }],
    };
    const good = fakeRelay({ answer: ({ verb, args }) => ({ by: machine, result: verb === "settings" && !Object.keys(args).length ? { ok: true, settings } : { ok: false } }) });
    expect(await settingsOn({ signer: person, person: person.pk, relay: RELAY, fetch: good.relayFetch }, to())).toEqual({ ok: true, value: settings });
    expect(good.asked.map((a) => a.verb)).toEqual(["settings"]);
    const odd = fakeRelay({ answer: () => ({ by: machine, result: { ok: true, settings: { launch: "sometimes" } } }) });
    expect(await settingsOn({ signer: person, person: person.pk, relay: RELAY, fetch: odd.relayFetch }, to())).toEqual({
      ok: false,
      detail: "that computer answered in a shape this app doesn't know",
    });
  });
});
