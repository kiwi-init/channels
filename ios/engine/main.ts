import { b64url, decodeJoinCode } from "@kiwi/core/crypto.ts";
import { claimDevice } from "@kiwi/core/devices.ts";
import type { EnrollGrant } from "@kiwi/core/enroll.ts";
import type { HarnessRow } from "@kiwi/core/harnesses.ts";
import { askToLink, dropLink, linkDigits, newLinkKeys, openLink, readLinkCode, waitForLinkChunks, type LinkCode, type LinkKeys } from "@kiwi/core/link.ts";
import type { Signed, SigningBudget } from "@kiwi/core/sas.ts";
import { handleFor } from "@kiwi/core/membership.ts";
import type { LaunchedView } from "@kiwi/core/terminals.ts";
import type { Identity } from "@kiwi/core/identity.ts";
import { workosDeviceSignIn, type DeviceSignIn } from "@kiwi/core/workos.ts";

import type { ChannelIdentityView, EnrollStatusView, FromMachine } from "../../desktop/src/bridge.ts";
import { createEnrollee, type Enrollee } from "../../desktop/src/devices.ts";
import { Keyring } from "../../desktop/src/keyring.ts";
import { launchRequestOf } from "../../desktop/src/launch-view.ts";
import { foldersOn, launchOn, personMachines, remoteHarnesses, type Asker, type PairedComputer } from "../../desktop/src/remote.ts";
import { acceptSeat, migrateEntries, withAccess } from "../../desktop/src/seats.ts";
import { canonicalHarness, harnessName, monoHarness } from "../../web/src/lib/harness.ts";
import { Room } from "./room.ts";
import type { Ask, EnrollStart, HarnessChoice, LaunchAsk, Push, Reply, Saved } from "./wire.ts";

interface Handler {
  postMessage(json: string): void;
}

const LINK_WAIT_MS = 10 * 60_000;
const ENROLL_EVERY_MS = 1_500;
const JOINS_EVERY_MS = 5_000;

interface Hosts {
  webkit?: { messageHandlers?: { kiwi?: Handler } };
  kiwiAndroid?: Handler;
}

const handler = (): Handler | null => {
  const hosts = globalThis as Hosts;
  return hosts.webkit?.messageHandlers?.kiwi ?? hosts.kiwiAndroid ?? null;
};

let sink: (p: Push) => void = (p) => handler()?.postMessage(JSON.stringify(p));

const post = (p: Push): void => sink(p);

let saved: Saved | null = null;
let keyring: Keyring | null = null;
const rooms = new Map<string, Room>();
let linking: { code: LinkCode; keys: LinkKeys; stop: AbortController } | null = null;
let computers = new Map<string, PairedComputer>();
let computersKnown = false;
let computersTimer: ReturnType<typeof setInterval> | null = null;
let joinsTimer: ReturnType<typeof setInterval> | null = null;
let enrolling: Enrolling | null = null;

interface Enrolling {
  relay: string;
  token: Promise<string>;
  enrollee: Enrollee;
  device: Identity | null;
  grant: EnrollGrant | null;
  done: boolean;
  stop: AbortController;
}
const COMPUTERS_EVERY_MS = 5 * 60_000;

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
  if (computersTimer) clearInterval(computersTimer);
  computersTimer = null;
  if (joinsTimer) clearInterval(joinsTimer);
  joinsTimer = null;
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
    prove: async (code, memberPk) => {
      const device = saved?.device;
      return device ? { device: await claimDevice(device.key, device.links, decodeJoinCode(code).roomId, memberPk) } : null;
    },
    githubToken: async () => null,
    person: personPk,
    mine: () => (computersKnown ? [...computers.keys()] : null),
    budget,
  });
  keyring = ring;
  for (const seat of next.seats) openRoom(ring, seat);
  watchJoins();
  if (next.person) {
    const load = () => void listComputers().catch(() => {});
    load();
    computersTimer = setInterval(load, COMPUTERS_EVERY_MS);
  }
  return rooms.size;
}

function personPk(): string | null {
  return saved?.person?.pk ?? saved?.device?.person.pk ?? null;
}

function openRoom(ring: Keyring, seat: ChannelIdentityView): void {
  if (!seat.code || !seat.access || rooms.has(seat.code)) return;
  const code = seat.code;
  const room = new Room(ring, seat, {
    emit: (view) => post({ type: "room", room: view }),
    lost: (gone) => post({ type: "gone", code: gone }),
    launch: (launch, seen) => post({ type: "launch", code, launch, stage: seen.stage, name: seen.name }),
    person: personPk,
    log: (line) => post({ type: "log", line }),
  });
  rooms.set(code, room);
  void room.start();
}

const asking = (s: ChannelIdentityView): boolean => !!s.code && !!s.requestId && !s.access;

function watchJoins(): void {
  if (joinsTimer || !seats().some(asking)) return;
  joinsTimer = setInterval(() => void checkJoins(), JOINS_EVERY_MS);
}

async function checkJoins(): Promise<void> {
  const ring = keyring;
  if (!ring) return;
  for (const code of seats()
    .filter(asking)
    .map((s) => s.code!)) {
    const got = await ring.joinStatus(code).catch(() => null);
    if (keyring !== ring || !got || got.status === "pending") continue;
    if (got.status === "denied") {
      if (saved) keep({ ...saved, seats: saved.seats.filter((c) => c.code !== code) });
      continue;
    }
    const seat = seats().find((c) => c.code === code && !!c.access);
    if (seat) openRoom(ring, seat);
  }
  if (keyring === ring && !seats().some(asking) && joinsTimer) {
    clearInterval(joinsTimer);
    joinsTimer = null;
  }
}

function room(code: string): Room {
  const r = rooms.get(code);
  if (!r) throw new Error("this phone isn't in that channel");
  return r;
}

function asker(): Asker {
  const person = saved?.person;
  if (saved?.device && !person) throw new Error("this phone signed in without your person key: start agents from Channels on your computer");
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
  computersKnown = true;
  return listed;
}

function choice(row: HarnessRow): HarnessChoice {
  const face = canonicalHarness(row.harness) ?? row.harness;
  return { ...row, name: harnessName(row.harness), face, mono: monoHarness(face) };
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

const pause = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

async function relaySignIn(relay: string, user: string | undefined, signal: AbortSignal): Promise<{ start: DeviceSignIn | null; token: Promise<string> }> {
  const res = await fetch(new URL("/v1/config", relay)).catch((err: unknown) => {
    throw new Error(`couldn't reach ${relay}: ${err instanceof Error ? err.message : String(err)}`);
  });
  if (!res.ok) throw new Error(`${relay} returned ${res.status}`);
  const config = (await res.json()) as { workosClientId?: string | null; dev?: boolean };
  if (config.dev) {
    const name = (user ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
    if (!name) throw new Error("this relay takes dev sign-in: give the name your computer's app signed in with");
    return { start: null, token: Promise.resolve(`dev:${name}`) };
  }
  if (!config.workosClientId) throw new Error(`${relay} has no sign-in: link this phone with a code from your Mac instead`);
  let shown: (s: DeviceSignIn) => void = () => {};
  const start = new Promise<DeviceSignIn>((resolve) => (shown = resolve));
  const token = workosDeviceSignIn(config.workosClientId, async (s) => shown(s), { signal }).then((s) => s.access);
  token.catch(() => {});
  return { start: await Promise.race([start, token.then(() => start)]), token };
}

async function enrollCancel(): Promise<void> {
  const e = enrolling;
  enrolling = null;
  if (!e) return;
  e.stop.abort();
  await e.enrollee.cancel();
}

async function enrollBegin(relay: string, label: string, os: string, user?: string): Promise<EnrollStart> {
  await enrollCancel();
  if (saved?.person || saved?.device) throw new Error("this phone is already one of your devices");
  const stop = new AbortController();
  const signIn = await relaySignIn(relay, user, stop.signal);
  const e: Enrolling = {
    relay,
    token: signIn.token,
    device: null,
    grant: null,
    done: false,
    stop,
    enrollee: createEnrollee({
      relayUrl: () => relay,
      token: () => e.token,
      who: () => null,
      device: () => e.device,
      saveDevice: (d) => void (e.device = d),
      enrolled: (grant) => void (e.grant = grant),
      label: () => label,
      os: () => os,
      as: "phone",
    }),
  };
  enrolling = e;
  return { url: signIn.start?.url ?? null, code: signIn.start?.code ?? "" };
}

async function enrollStage(e: Enrolling, until: (st: EnrollStatusView) => boolean): Promise<EnrollStatusView> {
  for (;;) {
    const st = await e.enrollee.status();
    if (enrolling !== e || !st) throw new Error("signing in was cancelled");
    if (st.stage === "gone") {
      enrolling = null;
      throw new Error("your computer turned this phone away, or the ask ran out: sign in again");
    }
    if (st.stage === "done") e.done = true;
    if (until(st) || e.done) return st;
    await pause(ENROLL_EVERY_MS, e.stop.signal);
  }
}

async function enrollWait(): Promise<{ digits: string }> {
  const e = enrolling;
  if (!e) throw new Error("signing in hasn't started");
  await e.token;
  if (enrolling !== e) throw new Error("signing in was cancelled");
  await e.enrollee.begin();
  const st = await enrollStage(e, (s) => s.stage === "digits");
  return { digits: st.stage === "digits" ? st.digits : "" };
}

async function enrollFinish(): Promise<Saved> {
  const e = enrolling;
  if (!e) throw new Error("signing in hasn't started");
  if (!e.done) await enrollStage(e, (s) => s.stage === "done");
  enrolling = null;
  const { grant, device } = e;
  if (!grant || !device?.xpk || !device.xsk) throw new Error("the grant came without this phone's keys: sign in again");
  const key = { name: device.name, pk: device.pk, sk: device.sk, xpk: device.xpk, xsk: device.xsk };
  start({ relay: grant.relay, person: null, device: { key, links: grant.links, person: grant.person }, seats: [] });
  keep(saved!);
  const ring = keyring!;
  const name = handleFor(grant.person.name);
  for (const c of grant.channels) {
    await ring.requestJoin(c.code, name).catch((err: unknown) => post({ type: "log", line: `couldn't ask to join ${c.label}: ${err instanceof Error ? err.message : String(err)}` }));
  }
  watchJoins();
  return saved!;
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
    case "enrollBegin":
      return enrollBegin(ask.relay, ask.label, ask.os, ask.user);
    case "enrollWait":
      return enrollWait();
    case "enrollFinish":
      return enrollFinish();
    case "enrollCancel":
      await enrollCancel();
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
      const got = valueOf(await remoteHarnesses(asker(), { pk: c.key, xpk: c.xpk }));
      return { harnesses: got.harnesses.map(choice), bypass: got.bypass };
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
