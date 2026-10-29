import { accountClient, type AccountClient } from "@kiwi/core/account.ts";
import { approvingDevice, certUntil, dueForRenewal, listedComputer, nextLink, readDeviceList, rootLink, type DeviceLink, type DeviceLinkBody, type DeviceList } from "@kiwi/core/devices.ts";
import { askToEnroll, enrollDigits, enrollMailbox, enrollNonce, readEnrollGrant, revealMatches, type EnrollGrant, type Enrollment } from "@kiwi/core/enroll.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { certifyMachine } from "@kiwi/core/person.ts";
import type { ComputerView, DeviceNewsView, DeviceView, EnrollAskView, EnrollConfirmView, EnrollStatusView, PublicPerson } from "./bridge.ts";

const TRIES = 3;
const RENEW_EVERY_MS = 6 * 3_600_000;

export interface DeviceHostDeps {
  relayUrl: () => string;
  token: () => Promise<string | null>;
  person: () => Identity | null;
  who: () => PublicPerson | null;
  device: () => Identity | null;
  saveDevice: (d: Identity) => void;
  links: () => DeviceLink[];
  saveLinks: (links: DeviceLink[]) => void;
  channels: () => { label: string; code: string }[];
  computer?: (c: ComputerView) => void;
  label: () => string;
  os: () => string;
  wipe: () => void;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface DeviceHost {
  poll(): Promise<EnrollAskView | null>;
  answer(id: string): Promise<void>;
  confirm(id: string, digits: string): Promise<EnrollConfirmView>;
  deny(id: string): Promise<void>;
  list(): Promise<DeviceView[] | null>;
  forget(device: string): Promise<void>;
  renew(device: string): Promise<void>;
  news(): Promise<DeviceNewsView | null>;
  addComputer(m: { pk: string; xpk: string; label: string; os: string }): Promise<DeviceLink[] | null>;
}

async function readList(links: unknown[]): Promise<DeviceList> {
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(`your device list doesn't hold up: ${read.why}`);
  return read.list;
}

async function myDevice(deps: Pick<DeviceHostDeps, "device" | "saveDevice">, name: string): Promise<Identity> {
  const held = deps.device();
  if (held?.xsk) return held;
  const made = await withExchangeKey(await generateIdentity(name));
  deps.saveDevice(made);
  return made;
}

export function createDeviceHost(deps: DeviceHostDeps): DeviceHost {
  const now = deps.now ?? Date.now;
  const answered = new Map<string, { nonce: string; tries: number }>();
  let synced: { relay: string; client: AccountClient; device: Identity } | null = null;
  let removed: DeviceNewsView["removed"] = null;
  let renewedAt = -Infinity;

  const cutOff = (by: string) => {
    synced = null;
    removed = deps.person() ? { wiped: false, by } : { wiped: true, by };
    if (removed.wiped) deps.wipe();
  };

  const signerLabel = (list: DeviceList, pk: string): string =>
    pk === list.person ? "your person key" : (list.devices.find((d) => d.device === pk)?.label ?? list.revokes.find((r) => r.device === pk)?.label ?? "a device");

  const revokedHere = async (links: unknown[], device: Identity): Promise<boolean> => {
    const read = await readDeviceList(links);
    const who = deps.who();
    if (!read.ok || !who || read.list.person !== who.pk || !read.list.revoked.includes(device.pk)) return false;
    const by = read.list.revokes.find((r) => r.device === device.pk)?.by ?? "";
    cutOff(signerLabel(read.list, by));
    return true;
  };

  const sync = async (): Promise<{ client: AccountClient; device: Identity } | null> => {
    if (removed) return null;
    const relay = deps.relayUrl();
    if (synced?.relay === relay) return synced;
    const who = deps.who();
    const token = await deps.token();
    if (!who || !token) return null;
    const device = await myDevice(deps, who.name);
    const client = accountClient(relay, async () => (await deps.token()) ?? token, device, deps.fetchImpl);
    const kept = await client.links();
    if (await revokedHere(kept, device)) return null;
    let ours = deps.links();
    if (!ours.length) {
      const person = deps.person();
      if (!person) throw new Error("this app lost its device list: forget it from another of your devices and sign in again");
      ours = [await rootLink(person, { pk: device.pk, xpk: device.xpk!, label: deps.label(), os: deps.os(), as: "desktop" }, now())];
    }
    if (!kept.length) {
      await client.publish(ours);
    } else {
      const theirs = await readList(kept);
      if (theirs.person !== who.pk) throw new Error("this sign-in already belongs to another Channels person key");
      if (kept.length >= ours.length) ours = kept as DeviceLink[];
      else await client.publish(ours);
    }
    if (!(await readList(ours)).devices.some((d) => d.device === device.pk)) throw new Error("this app isn't in your device list any more");
    deps.saveLinks(ours);
    synced = { relay, client, device };
    return synced;
  };

  const refresh = async (s: { client: AccountClient; device: Identity }): Promise<boolean> => {
    const kept = (await s.client.links()) as DeviceLink[];
    if (await revokedHere(kept, s.device)) return false;
    if (kept.length > deps.links().length) deps.saveLinks(kept);
    return true;
  };

  const renewDue = async (s: { client: AccountClient; device: Identity }) => {
    if (now() - renewedAt < RENEW_EVERY_MS) return;
    renewedAt = now();
    const list = await readList(deps.links());
    if (!list.devices.some((d) => d.device === s.device.pk && d.approve)) return;
    for (const d of dueForRenewal(list, now())) await extend(s.client, s.device, { op: "renew", device: d.device, until: certUntil(now()) });
  };

  const live = async (id: string): Promise<{ client: AccountClient; device: Identity; e: Enrollment }> => {
    const s = await sync();
    if (!s) throw new Error("sign in to approve a device");
    const e = await s.client.enrollment();
    if (!e || e.id !== id) throw new Error("that device stopped asking");
    return { ...s, e };
  };

  const extend = async (client: AccountClient, device: Identity, body: DeviceLinkBody): Promise<{ links: DeviceLink[]; list: DeviceList }> => {
    const kept = (await client.links()) as DeviceLink[];
    const base = kept.length > deps.links().length ? kept : deps.links();
    const list = await readList(base);
    if (!list.devices.some((d) => d.device === device.pk && d.approve)) throw new Error("this app can't change your devices any more");
    const links = [...base, await nextLink(list, device, body, now())];
    await client.publish(links);
    deps.saveLinks(links);
    return { links, list };
  };

  const signedIn = async () => {
    const s = await sync();
    if (!s) throw new Error("sign in to change your devices");
    return s;
  };

  return {
    async poll() {
      let s: Awaited<ReturnType<typeof sync>>;
      try {
        s = await sync();
      } catch (err) {
        synced = null;
        throw err;
      }
      if (!s || !(await refresh(s))) return null;
      try {
        await renewDue(s);
      } catch {
        // Another app renewed first, or the relay is away: the list stays as it was, and the next round tries again.
      }
      const e = await s.client.enrollment();
      if (!e) {
        answered.clear();
        return null;
      }
      const mine = e.answer?.device === s.device.pk && answered.has(e.id);
      const stage = !e.answer ? "new" : !mine ? "elsewhere" : e.reveal ? "digits" : "waiting";
      return { id: e.id, label: e.ask.label, os: e.ask.os, as: e.ask.as, at: e.at, stage };
    },

    async answer(id) {
      const { client, device, e } = await live(id);
      if (e.answer) throw new Error("another app already answered this device");
      const nonce = enrollNonce();
      await client.answer(id, { device: device.pk, dxpk: device.xpk!, nonce });
      answered.set(id, { nonce, tries: 0 });
    },

    async confirm(id, digits) {
      const { client, device, e } = await live(id);
      const ours = answered.get(id);
      if (!ours || !e.answer || e.answer.device !== device.pk) throw new Error("this app didn't answer that device: turn it away and ask again");
      if (!e.reveal) throw new Error("the device hasn't shown its digits yet");
      const answer = { device: device.pk, dxpk: device.xpk!, nonce: ours.nonce };
      const honest = e.answer.nonce === ours.nonce && (await revealMatches(e.ask, e.reveal.nonce));
      const expected = honest ? await enrollDigits(e.ask, answer, e.reveal.nonce) : null;
      if (expected === null || digits.replace(/\D/g, "") !== expected) {
        ours.tries++;
        const left = TRIES - ours.tries;
        if (left <= 0) {
          answered.delete(id);
          await client.drop(id).catch(() => {});
        }
        return { ok: false, left: Math.max(0, left) };
      }
      const { links, list } = await extend(client, device, {
        op: "add",
        device: e.ask.device,
        dxpk: e.ask.dxpk,
        label: e.ask.label,
        os: e.ask.os,
        as: e.ask.as,
        approve: e.ask.as === "desktop",
        until: certUntil(now()),
      });
      const who = deps.who();
      if (!who || who.pk !== list.person) throw new Error("this app's person doesn't match your device list");
      const person = e.ask.as === "computer" ? deps.person() : null;
      const cert = person ? await certifyMachine(person, { pk: e.ask.device, xpk: e.ask.dxpk, label: e.ask.label }, now()) : null;
      const grant: EnrollGrant = {
        kind: "kiwi-enroll-grant",
        v: 1,
        links,
        person: { pk: who.pk, name: who.name, xpk: who.xpk },
        relay: deps.relayUrl(),
        channels: deps.channels(),
        ...(cert ? { cert } : {}),
      };
      const mailbox = await enrollMailbox(deps.relayUrl(), device, { ...e, answer: { ...answer, at: e.answer.at } }, deps.fetchImpl);
      await mailbox.put("b", grant);
      if (e.ask.as === "computer") deps.computer?.({ label: e.ask.label, os: e.ask.os, machinePk: e.ask.device, machineXpk: e.ask.dxpk, personPk: who.pk, at: now() });
      answered.delete(id);
      await client.drop(id).catch(() => {});
      return { ok: true, label: e.ask.label };
    },

    async deny(id) {
      const s = await sync();
      if (!s) return;
      answered.delete(id);
      await s.client.drop(id);
    },

    async list() {
      const s = await sync();
      if (!s || !(await refresh(s))) return null;
      const list = await readList(deps.links());
      return list.devices.map((d) => ({ id: d.device, label: d.label, os: d.os, as: d.as, approve: d.approve, until: d.until, thisOne: d.device === s.device.pk }));
    },

    async forget(target) {
      const { client, device } = await signedIn();
      if (target === device.pk) throw new Error("forget this app from another of your devices");
      await extend(client, device, { op: "revoke", device: target });
    },

    async renew(target) {
      const { client, device } = await signedIn();
      await extend(client, device, { op: "renew", device: target, until: certUntil(now()) });
    },

    async addComputer(m) {
      const s = await sync();
      if (!s || !(await refresh(s))) return null;
      const list = await readList(deps.links());
      if (!approvingDevice(list, s.device.pk, now())) return null;
      if (list.revoked.includes(m.pk)) throw new Error("this computer was removed from your devices: it needs a new kiwi key before it can be added again");
      if (listedComputer(list, m.pk, now())) return deps.links();
      const listed = list.devices.find((d) => d.device === m.pk);
      if (listed && listed.as !== "computer") throw new Error("this computer's key is listed as another kind of device");
      if (listed) {
        const { links } = await extend(s.client, s.device, { op: "renew", device: m.pk, until: certUntil(now()) });
        return links;
      }
      const { links } = await extend(s.client, s.device, { op: "add", device: m.pk, dxpk: m.xpk, label: m.label, os: m.os, as: "computer", approve: false, until: certUntil(now()) });
      return links;
    },

    async news() {
      if (removed) return { links: [], revokes: [], removed };
      const links = deps.links();
      if (!links.length) return null;
      const list = await readList(links);
      const revokes = list.revokes.map((r) => ({ device: r.device, label: r.label, as: r.as, by: signerLabel(list, r.by), at: r.at, older: r.older }));
      return { links, revokes, removed: null };
    },
  };
}

export interface EnrolleeDeps {
  relayUrl: () => string;
  token: () => Promise<string | null>;
  who: () => PublicPerson | null;
  device: () => Identity | null;
  saveDevice: (d: Identity) => void;
  enrolled: (grant: EnrollGrant) => void;
  label: () => string;
  os: () => string;
  as?: "desktop" | "phone";
  fetchImpl?: typeof fetch;
}

export interface Enrollee {
  begin(): Promise<void>;
  status(): Promise<EnrollStatusView | null>;
  cancel(): Promise<void>;
}

interface Asking {
  id: string;
  nonce: string;
  relay: string;
  client: AccountClient;
  device: Identity;
  seen: Enrollment | null;
}

export function createEnrollee(deps: EnrolleeDeps): Enrollee {
  let asking: Asking | null = null;

  return {
    async begin() {
      if (deps.who()) throw new Error("this app already holds your person");
      const token = await deps.token();
      if (!token) throw new Error("sign in first, with the account your other computer uses");
      if (asking) await asking.client.drop(asking.id).catch(() => {});
      asking = null;
      const relay = deps.relayUrl();
      const device = await myDevice(deps, deps.label());
      const client = accountClient(relay, async () => (await deps.token()) ?? token, device, deps.fetchImpl);
      const { ask, nonce } = await askToEnroll(device, { label: deps.label(), os: deps.os(), as: deps.as ?? "desktop" });
      const id = await client.ask(ask);
      asking = { id, nonce, relay, client, device, seen: null };
    },

    async status() {
      const a = asking;
      if (!a) return null;
      if (!a.seen) {
        const e = await a.client.enrollment();
        if (asking !== a) return null;
        if (!e || e.id !== a.id) {
          asking = null;
          return { stage: "gone" };
        }
        if (!e.answer) return { stage: "asking" };
        if (!e.reveal) await a.client.reveal(a.id, a.nonce);
        a.seen = { ...e, reveal: { nonce: a.nonce, at: e.reveal?.at ?? Date.now() } };
      }
      const e = a.seen;
      const mailbox = await enrollMailbox(a.relay, a.device, e, deps.fetchImpl);
      let raw = await mailbox.get("b");
      if (asking !== a) return null;
      if (raw === null) {
        const still = await a.client.enrollment();
        if (still?.id === a.id) return { stage: "digits", digits: await enrollDigits(e.ask, e.answer!, a.nonce) };
        raw = await mailbox.get("b");
        if (asking !== a) return null;
        if (raw === null) {
          asking = null;
          return { stage: "gone" };
        }
      }
      const grant = await readEnrollGrant(raw, a.device.pk);
      if (!grant) throw new Error("the grant your other computer sent doesn't hold up");
      asking = null;
      deps.enrolled(grant);
      await mailbox.drop();
      return { stage: "done", person: grant.person, channels: grant.channels };
    },

    async cancel() {
      const a = asking;
      asking = null;
      if (a) await a.client.drop(a.id).catch(() => {});
    },
  };
}
