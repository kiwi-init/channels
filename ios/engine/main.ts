import { b64url, decodeJoinCode } from "@kiwi/core/crypto.ts";
import { claimDevice, readDeviceList, type DeviceLink, type DeviceList } from "@kiwi/core/devices.ts";
import type { EnrollGrant } from "@kiwi/core/enroll.ts";
import type { HarnessRow } from "@kiwi/core/harnesses.ts";
import type { Signed, SigningBudget } from "@kiwi/core/sas.ts";
import { handleFor } from "@kiwi/core/membership.ts";
import type { LaunchedView } from "@kiwi/core/terminals.ts";
import type { Identity } from "@kiwi/core/identity.ts";
import { pollToken, startDevice } from "@kiwi/core/github-device.ts";
import { workosDeviceSignIn, type DeviceSignIn, type WorkosFetch } from "@kiwi/core/workos.ts";

import type { ChannelIdentityView, EnrollPersonView, EnrollStatusView, FromMachine } from "../../desktop/src/bridge.ts";
import { createEnrollee, type Enrollee } from "../../desktop/src/devices.ts";
import { Keyring } from "../../desktop/src/keyring.ts";
import { launchRequestOf } from "../../desktop/src/launch-view.ts";
import { foldersOn, launchOn, personMachines, remoteHarnesses, type Asker, type PairedComputer } from "../../desktop/src/remote.ts";
import { acceptSeat, withAccess } from "../../desktop/src/seats.ts";
import { canonicalHarness, harnessName, monoHarness } from "@kiwi/app/harness.ts";
import { Room } from "./room.ts";
import type { Ask, EnrollStart, Fetched, HarnessChoice, LaunchAsk, Push, Reply, Saved } from "./wire.ts";

interface Handler {
  postMessage(json: string): void;
}

const ENROLL_EVERY_MS = 1_500;
const JOINS_EVERY_MS = 5_000;
const OPEN_WAIT_MS = 20_000;
const HOST_FETCH_MS = 25_000;

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
let computers = new Map<string, PairedComputer>();
let computersKnown = false;
let computersTimer: ReturnType<typeof setInterval> | null = null;
let joinsTimer: ReturnType<typeof setInterval> | null = null;
let enrolling: Enrolling | null = null;
let opening: AbortController | null = null;
const fetches = new Map<number, (got: Fetched) => void>();
let fetchSeq = 0;

interface Enrolling {
  relay: string;
  token: Promise<string>;
  enrollee: Enrollee;
  device: Identity | null;
  grant: EnrollGrant | null;
  stop: AbortController;
  asked: Promise<void> | null;
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
    devices: heardList,
  });
  rooms.set(code, room);
  void room.start();
}

let taking: Promise<unknown> = Promise.resolve();

function heardList(links: unknown): void {
  taking = taking.then(() => takeList(links)).catch(() => null);
}

const signerLabel = (list: DeviceList, pk: string): string =>
  pk === list.person ? "your person key" : (list.devices.find((d) => d.device === pk)?.label ?? list.revokes.find((r) => r.device === pk)?.label ?? "another device");

async function takeList(links: unknown): Promise<void> {
  const device = saved?.device;
  if (!device || !Array.isArray(links)) return;
  const read = await readDeviceList(links);
  if (!read.ok || read.list.person !== device.person.pk) return;
  const kept = await readDeviceList(device.links);
  if ((kept.ok && read.list.version <= kept.list.version) || saved?.device !== device) return;
  if (read.list.revoked.includes(device.key.pk)) {
    const by = read.list.revokes.find((r) => r.device === device.key.pk)?.by ?? "";
    const relay = saved.relay;
    stopAll();
    saved = { relay, person: null, seats: [], device: null };
    post({ type: "removed", by: signerLabel(read.list, by) });
    return;
  }
  keep({ ...saved, device: { ...device, links: links as DeviceLink[] } });
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
  if (!saved || !person) throw new Error("sign in on this phone first");
  return { signer: person, person: person.pk, relay: saved.relay };
}

function computer(key: string): PairedComputer {
  const c = computers.get(key);
  if (!c) throw new Error("that isn't one of your computers");
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

const pause = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

const said = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function within<T>(work: Promise<T>, ms: number, who: string, stop: AbortController): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancelled = () => (clearTimeout(timer), reject(new Error("signing in was cancelled")));
    const timer = setTimeout(() => {
      stop.signal.removeEventListener("abort", cancelled);
      const s = Math.ceil(ms / 1000);
      reject(new Error(`${who} didn't answer in ${s} second${s === 1 ? "" : "s"}: check the connection, then sign in again`));
      stop.abort();
    }, ms);
    if (stop.signal.aborted) return cancelled();
    stop.signal.addEventListener("abort", cancelled, { once: true });
    work.then(
      (value) => (clearTimeout(timer), stop.signal.removeEventListener("abort", cancelled), resolve(value)),
      (err: unknown) => (clearTimeout(timer), stop.signal.removeEventListener("abort", cancelled), reject(err)),
    );
  });
}

const viaHost: WorkosFetch = (url, init) =>
  new Promise<Response>((resolve, reject) => {
    const signal = init.signal;
    if (signal?.aborted) return reject(new Error("sign-in was stopped"));
    const id = ++fetchSeq;
    const stopped = () => (clearTimeout(timer), fetches.delete(id), reject(new Error("sign-in was stopped")));
    const timer = setTimeout(() => {
      fetches.delete(id);
      signal?.removeEventListener("abort", stopped);
      post({ type: "log", line: "sign-in: no answer from the sign-in service, asking again" });
      reject(new Error("the sign-in service didn't answer"));
    }, HOST_FETCH_MS);
    signal?.addEventListener("abort", stopped, { once: true });
    fetches.set(id, (got) => {
      clearTimeout(timer);
      fetches.delete(id);
      signal?.removeEventListener("abort", stopped);
      if ("error" in got) reject(new Error(got.error));
      else resolve(new Response(got.body, { status: got.status }));
    });
    post({ type: "fetch", id, url, body: typeof init.body === "string" ? init.body : "" });
  });

function fetched(json: string): void {
  const got = JSON.parse(json) as Fetched;
  fetches.get(got.id)?.(got);
}

interface RelayConfig {
  workosClientId?: string | null;
  dev?: boolean;
  githubSignIn?: boolean;
  githubClientId?: string;
}

async function readConfig(relay: string, signal: AbortSignal): Promise<RelayConfig> {
  const res = await fetch(new URL("/v1/config", relay), { signal }).catch((err: unknown) => {
    throw new Error(`couldn't reach ${relay}: ${said(err)}`);
  });
  if (!res.ok) throw new Error(`${relay} returned ${res.status}`);
  return (await res.json()) as RelayConfig;
}

async function relaySignIn(relay: string, user: string | undefined, stop: AbortController, waitMs: number): Promise<{ start: DeviceSignIn | null; token: Promise<string> }> {
  const signal = stop.signal;
  post({ type: "log", line: `sign-in: asking ${relay} how to sign in` });
  const config = await within(readConfig(relay, signal), waitMs, relay, stop);
  if (config.dev) {
    const name = (user ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
    if (!name) throw new Error("this relay takes dev sign-in: give the name your computer's app signed in with");
    return { start: null, token: Promise.resolve(`dev:${name}`) };
  }
  if (config.githubSignIn && config.githubClientId) return githubSignIn(config.githubClientId, stop, waitMs);
  if (!config.workosClientId) throw new Error(`${relay} has no sign-in, so this phone can't join your devices there`);
  post({ type: "log", line: `sign-in: starting WorkOS${handler() ? " through the app" : ""}` });
  let shown: (s: DeviceSignIn) => void = () => {};
  const start = new Promise<DeviceSignIn>((resolve) => (shown = resolve));
  const token = workosDeviceSignIn(config.workosClientId, async (s) => shown(s), { signal, fetchImpl: handler() ? viaHost : fetch }).then((s) => s.access);
  token.catch(() => {});
  const ready = Promise.race([start, token.then(() => start)]).catch((err: unknown) => {
    throw new Error(signal.aborted ? said(err) : `couldn't reach the sign-in service: ${said(err)}`);
  });
  const page = await within(ready, waitMs, "the sign-in service", stop);
  post({ type: "log", line: "sign-in: page ready" });
  return { start: page, token };
}

async function githubSignIn(clientId: string, stop: AbortController, waitMs: number): Promise<{ start: DeviceSignIn; token: Promise<string> }> {
  const signal = stop.signal;
  const via: WorkosFetch = handler() ? viaHost : fetch;
  post({ type: "log", line: `sign-in: starting GitHub${handler() ? " through the app" : ""}` });
  const opened = startDevice(clientId, via, signal).catch((err: unknown) => {
    throw new Error(signal.aborted ? said(err) : `couldn't reach GitHub's sign-in: ${said(err)}`);
  });
  const start = await within(opened, waitMs, "GitHub's sign-in", stop);
  const token = pollToken(clientId, start, { fetch: via, sleep: (ms) => pause(ms, signal), now: Date.now, signal });
  token.catch(() => {});
  post({ type: "log", line: "sign-in: page ready" });
  return { start: { url: start.url, code: start.userCode }, token };
}

async function enrollCancel(): Promise<void> {
  opening?.abort();
  opening = null;
  const e = enrolling;
  enrolling = null;
  if (!e) return;
  e.stop.abort();
  await e.enrollee.cancel();
}

async function enrollBegin(relay: string, label: string, os: string, user?: string, waitMs = OPEN_WAIT_MS): Promise<EnrollStart> {
  await enrollCancel();
  if (saved?.person || saved?.device) throw new Error("this phone is already one of your devices");
  const stop = new AbortController();
  opening = stop;
  const signIn = await relaySignIn(relay, user, stop, waitMs).finally(() => {
    if (opening === stop) opening = null;
  });
  const e: Enrolling = {
    relay,
    token: signIn.token,
    device: null,
    grant: null,
    stop,
    asked: null,
    enrollee: createEnrollee({
      relayUrl: () => relay,
      token: () => e.token,
      who: () => saved?.device?.person ?? (saved?.person ? { name: saved.person.name, pk: saved.person.pk, xpk: saved.person.xpk } : null),
      enrolled: (grant, device) => {
        e.grant = grant;
        e.device = device;
      },
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
    if (until(st) || st.stage === "check") return st;
    await pause(ENROLL_EVERY_MS, e.stop.signal);
  }
}

async function askComputer(e: Enrolling): Promise<void> {
  await e.token;
  if (enrolling !== e) throw new Error("signing in was cancelled");
  post({ type: "log", line: "sign-in: signed in, asking your computer" });
  await e.enrollee.begin();
}

async function enrollAsk(): Promise<null> {
  const e = enrolling;
  if (!e) throw new Error("signing in hasn't started");
  e.asked ??= askComputer(e);
  await e.asked;
  return null;
}

async function enrollWait(): Promise<{ digits: string }> {
  const e = enrolling;
  if (!e) throw new Error("signing in hasn't started");
  await enrollAsk();
  const st = await enrollStage(e, (s) => s.stage === "digits");
  return { digits: st.stage === "digits" ? st.digits : "" };
}

async function enrollCheck(): Promise<EnrollPersonView> {
  const e = enrolling;
  if (!e) throw new Error("signing in hasn't started");
  await enrollAsk();
  const st = await enrollStage(e, (s) => s.stage === "check");
  if (st.stage !== "check") throw new Error("your computer didn't send your person");
  return st.person;
}

async function enrollFinish(): Promise<Saved> {
  const e = enrolling;
  if (!e) throw new Error("signing in hasn't started");
  await e.enrollee.keep();
  if (enrolling !== e) throw new Error("signing in was cancelled, so this phone kept nothing");
  enrolling = null;
  if (saved?.person || saved?.device) throw new Error("this phone is already one of your devices, so it kept nothing");
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
    case "enrollBegin":
      return enrollBegin(ask.relay, ask.label, ask.os, ask.user, ask.waitMs);
    case "enrollAsk":
      return enrollAsk();
    case "enrollWait":
      return enrollWait();
    case "enrollCheck":
      return enrollCheck();
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
      for (const r of rooms.values()) r.nudge();
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

Object.assign(globalThis, { kiwi: { ask, listen, fetched } });
