import { b64url } from "@kiwi/core/crypto.ts";
import type { HarnessRow } from "@kiwi/core/harnesses.ts";
import { askToLink, dropLink, linkDigits, newLinkKeys, openLink, readLinkCode, waitForLinkChunks, type LinkCode, type LinkKeys } from "@kiwi/core/link.ts";
import type { Signed, SigningBudget } from "@kiwi/core/sas.ts";
import type { LaunchedView } from "@kiwi/core/terminals.ts";

import type { ChannelIdentityView, FromMachine } from "../../desktop/src/bridge.ts";
import { Keyring } from "../../desktop/src/keyring.ts";
import { launchRequestOf } from "../../desktop/src/launch-view.ts";
import { foldersOn, harnessesOn, launchOn, personMachines, type Asker, type PairedComputer } from "../../desktop/src/remote.ts";
import { acceptSeat, migrateEntries, withAccess } from "../../desktop/src/seats.ts";
import { Room } from "./room.ts";
import type { Ask, LaunchAsk, Push, Reply, Saved } from "./wire.ts";

interface Handler {
  postMessage(json: string): void;
}

const LINK_WAIT_MS = 10 * 60_000;

const handler = (): Handler | null => (globalThis as { webkit?: { messageHandlers?: { kiwi?: Handler } } }).webkit?.messageHandlers?.kiwi ?? null;

let sink: (p: Push) => void = (p) => handler()?.postMessage(JSON.stringify(p));

const post = (p: Push): void => sink(p);

let saved: Saved | null = null;
let keyring: Keyring | null = null;
const rooms = new Map<string, Room>();
let linking: { code: LinkCode; keys: LinkKeys; stop: AbortController } | null = null;
let computers = new Map<string, PairedComputer>();

const checks = new Map<string, Signed[]>();
const budget: SigningBudget = {
  load: (roomId) => checks.get(roomId) ?? [],
  save: (roomId, signed) => void checks.set(roomId, signed),
};

function keep(next: Saved): void {
  saved = next;
  post({ type: "saved", saved: next });
}

function seats(): ChannelIdentityView[] {
  return saved?.seats ?? [];
}

function stopAll(): void {
  for (const room of rooms.values()) room.stop();
  rooms.clear();
  keyring?.stopAll();
  keyring = null;
}

function start(next: Saved): number {
  stopAll();
  saved = next;
  const ring = new Keyring({
    relay: () => saved?.relay ?? next.relay,
    seats,
    save: async (entry) => {
      if (saved) keep({ ...saved, seats: acceptSeat(saved.seats, entry) });
    },
    access: async (code, pk, access) => {
      if (saved) keep({ ...saved, seats: withAccess(saved.seats, code, pk, access) });
    },
    forget: async (code) => {
      if (saved) keep({ ...saved, seats: saved.seats.filter((c) => c.code !== code) });
    },
    prove: async () => null,
    githubToken: async () => null,
    person: () => saved?.person?.pk ?? null,
    budget,
  });
  keyring = ring;
  for (const seat of next.seats) {
    if (!seat.code || !seat.access || rooms.has(seat.code)) continue;
    const code = seat.code;
    const room = new Room(ring, seat, {
      emit: (view) => post({ type: "room", room: view }),
      lost: (gone) => post({ type: "gone", code: gone }),
      launch: (launch, seen) => post({ type: "launch", code, launch, stage: seen.stage, name: seen.name }),
      person: () => saved?.person?.pk ?? null,
      log: (line) => post({ type: "log", line }),
    });
    rooms.set(seat.code, room);
    void room.start();
  }
  return rooms.size;
}

function room(code: string): Room {
  const r = rooms.get(code);
  if (!r) throw new Error("this phone isn't in that channel");
  return r;
}

function asker(): Asker {
  const person = saved?.person;
  if (!saved || !person) throw new Error("link this phone with the Mac app first");
  return { person, relay: saved.relay };
}

function computer(key: string): PairedComputer {
  const c = computers.get(key);
  if (!c) throw new Error("that isn't one of your paired computers");
  return c;
}

function valueOf<T>(got: FromMachine<T>): T {
  if (!got.ok) throw new Error(got.detail);
  return got.value;
}

async function listComputers(): Promise<PairedComputer[]> {
  const listed = valueOf(await personMachines(asker()));
  computers = new Map(listed.map((c) => [c.key, c]));
  return listed;
}

function roomIdOf(code: string): string {
  const roomId = seats().find((s) => s.code === code)?.roomId;
  if (!roomId) throw new Error("this phone isn't in that channel");
  return roomId;
}

async function launch(ask: LaunchAsk): Promise<LaunchedView> {
  const c = computer(ask.computer);
  const r = room(ask.code);
  const id = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const req = launchRequestOf({ ...ask, machinePk: c.key, launch: id, relay: asker().relay.replace(/\/+$/, "") });
  if (!req) throw new Error("that launch has something this phone can't send");
  r.follow(id);
  const launched = await launchOn(asker(), { pk: c.key, xpk: c.xpk, label: c.label }, req);
  if (!launched.ok) r.unfollow(id);
  return launched;
}

async function linkAsk(text: string, label: string): Promise<{ digits: string; relay: string }> {
  const code = readLinkCode(text);
  if (!code) throw new Error("that isn't a link code from the Channels app");
  linking?.stop.abort();
  const keys = await newLinkKeys();
  await askToLink(code.relay, code, keys.xpk, label);
  linking = { code, keys, stop: new AbortController() };
  return { digits: await linkDigits(code.secret, code.dxpk, keys.xpk), relay: code.relay };
}

async function linkWait(): Promise<Saved> {
  const l = linking;
  if (!l) throw new Error("linking hasn't started");
  const chunks = await waitForLinkChunks(l.code.relay, l.code.secret, { timeoutMs: LINK_WAIT_MS, everyMs: 1_500, signal: l.stop.signal });
  if (linking !== l) throw new Error("linking was cancelled");
  linking = null;
  if (!chunks) throw new Error("the Mac didn't send anything: start again from Link a phone");
  const payload = await openLink(l.code, l.keys.xsk, l.keys.xpk, chunks);
  await dropLink(l.code.relay, l.code.secret, chunks.length).catch(() => {});
  if (!payload) throw new Error("what came back wasn't sealed for this phone: start again");
  const here = payload.channels.filter((c) => c.relay === undefined || c.relay === payload.relayUrl);
  const { channels } = migrateEntries([], here);
  return { relay: payload.relayUrl, person: payload.person, seats: channels.filter((c) => !!c.access) };
}

async function handle(ask: Ask): Promise<unknown> {
  switch (ask.op) {
    case "start":
      return start(ask.saved);
    case "linkAsk":
      return linkAsk(ask.code, ask.label);
    case "linkWait":
      return linkWait();
    case "linkCancel":
      linking?.stop.abort();
      linking = null;
      return null;
    case "send":
      return room(ask.code).send(ask.body, ask.re, ask.imgs ?? [], ask.place ?? null);
    case "image":
      return room(ask.code).image(ask.seq, ask.index);
    case "answer":
      return room(ask.code).answer(ask.seq, ask.text);
    case "react":
      return room(ask.code).react(ask.seq, ask.emoji);
    case "approve":
      return room(ask.code).approve(ask.task);
    case "sendBack":
      return room(ask.code).sendBack(ask.task, ask.why);
    case "open":
      room(ask.code).open(ask.place);
      return null;
    case "nudge":
      keyring?.nudge();
      return null;
    case "computers":
      return listComputers();
    case "harnessesOn": {
      const c = computer(ask.computer);
      return valueOf<HarnessRow[]>(await harnessesOn(asker(), { pk: c.key, xpk: c.xpk }));
    }
    case "foldersOn": {
      const c = computer(ask.computer);
      return valueOf(await foldersOn(asker(), { pk: c.key, xpk: c.xpk }, roomIdOf(ask.code)));
    }
    case "launch":
      return launch(ask);
  }
}

async function ask(json: string): Promise<string> {
  let reply: Reply;
  try {
    reply = { ok: true, value: (await handle(JSON.parse(json) as Ask)) ?? null };
  } catch (e) {
    reply = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return JSON.stringify(reply);
}

function listen(next: (p: Push) => void): void {
  sink = next;
}

Object.assign(globalThis, { kiwi: { ask, listen } });
