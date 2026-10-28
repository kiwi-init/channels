import { accountClient, type AccountClient } from "@kiwi/core/account.ts";
import { certUntil, nextLink, readDeviceList, rootLink, type DeviceLink, type DeviceLinkBody, type DeviceList } from "@kiwi/core/devices.ts";
import { enrollDigits, enrollMailbox, enrollNonce, revealMatches, type EnrollGrant, type Enrollment } from "@kiwi/core/enroll.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import type { DeviceView, EnrollAskView, EnrollConfirmView } from "./bridge.ts";

const TRIES = 3;

export interface DeviceHostDeps {
  relayUrl: () => string;
  token: () => Promise<string | null>;
  person: () => Identity | null;
  device: () => Identity | null;
  saveDevice: (d: Identity) => void;
  links: () => DeviceLink[];
  saveLinks: (links: DeviceLink[]) => void;
  channels: () => { label: string; code: string }[];
  label: () => string;
  os: () => string;
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
}

async function readList(links: unknown[]): Promise<DeviceList> {
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(`your device list doesn't hold up: ${read.why}`);
  return read.list;
}

export function createDeviceHost(deps: DeviceHostDeps): DeviceHost {
  const now = deps.now ?? Date.now;
  const answered = new Map<string, { nonce: string; tries: number }>();
  let synced: { relay: string; client: AccountClient; device: Identity } | null = null;

  const myDevice = async (person: Identity): Promise<Identity> => {
    const held = deps.device();
    if (held?.xsk) return held;
    const made = await withExchangeKey(await generateIdentity(person.name));
    deps.saveDevice(made);
    return made;
  };

  const sync = async (): Promise<{ client: AccountClient; device: Identity } | null> => {
    const relay = deps.relayUrl();
    if (synced?.relay === relay) return synced;
    const person = deps.person();
    const token = await deps.token();
    if (!person || !token) return null;
    const device = await myDevice(person);
    const client = accountClient(relay, async () => (await deps.token()) ?? token, device, deps.fetchImpl);
    const kept = await client.links();
    let ours = deps.links();
    if (!ours.length) ours = [await rootLink(person, { pk: device.pk, xpk: device.xpk!, label: deps.label(), os: deps.os(), as: "desktop" }, now())];
    if (!kept.length) {
      await client.publish(ours);
    } else {
      const theirs = await readList(kept);
      if (theirs.person !== person.pk) throw new Error("this sign-in already belongs to another Channels person key");
      if (kept.length >= ours.length) ours = kept as DeviceLink[];
      else await client.publish(ours);
    }
    if (!(await readList(ours)).devices.some((d) => d.device === device.pk)) throw new Error("this app isn't in your device list any more");
    deps.saveLinks(ours);
    synced = { relay, client, device };
    return synced;
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
      if (!s) return null;
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
      const person = deps.person();
      const grant: EnrollGrant = { kind: "kiwi-enroll-grant", v: 1, links, person: { pk: list.person, name: person?.name ?? "" }, relay: deps.relayUrl(), channels: deps.channels() };
      const mailbox = await enrollMailbox(deps.relayUrl(), device, { ...e, answer: { ...answer, at: e.answer.at } }, deps.fetchImpl);
      await mailbox.put("b", grant);
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
      if (!s) return null;
      const kept = (await s.client.links()) as DeviceLink[];
      if (kept.length > deps.links().length) deps.saveLinks(kept);
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
  };
}
