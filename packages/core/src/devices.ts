import { b64url } from "./crypto.ts";
import { canonical, sign, signText, verify, verifyText, type Identity } from "./identity.ts";

const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const LABEL_MAX = 64;
const OS_MAX = 32;
const DAY_MS = 86_400_000;
const DEVICE_CERT_DAYS = 90;
export const DEVICE_LIST_MAX = 1024;
const RENEW_WITHIN_DAYS = 14;

type DeviceKind = "desktop" | "phone" | "computer";
const KINDS: readonly DeviceKind[] = ["desktop", "phone", "computer"];

export type DeviceLinkBody =
  | { op: "add"; device: string; dxpk: string; label: string; os: string; as: DeviceKind; approve: boolean; until: number }
  | { op: "approve"; device: string }
  | { op: "renew"; device: string; until: number }
  | { op: "revoke"; device: string };

interface LinkHead {
  kind: "kiwi-device-link";
  v: 1;
  person: string;
  seq: number;
  prev: string | null;
  at: number;
}

export type DeviceLink = LinkHead & DeviceLinkBody & { pk: string; sig: string };

export interface Device {
  device: string;
  dxpk: string;
  label: string;
  os: string;
  as: DeviceKind;
  approve: boolean;
  until: number;
  seq: number;
}

interface Revoke {
  device: string;
  label: string;
  as: DeviceKind;
  approve: boolean;
  by: string;
  seq: number;
  at: number;
  older: boolean;
}

export interface DeviceList {
  person: string;
  version: number;
  head: string;
  devices: Device[];
  revoked: string[];
  revokes: Revoke[];
}

export type ReadList = { ok: true; list: DeviceList } | { ok: false; why: string };

const FIELDS: Record<DeviceLinkBody["op"], string> = {
  add: "approve,as,at,device,dxpk,kind,label,op,os,person,pk,prev,seq,sig,until,v",
  approve: "at,device,kind,op,person,pk,prev,seq,sig,v",
  renew: "at,device,kind,op,person,pk,prev,seq,sig,until,v",
  revoke: "at,device,kind,op,person,pk,prev,seq,sig,v",
};

function clean(s: string, max: number): string {
  return s
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2060-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

async function digest(link: DeviceLink): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(link)))));
}

export const certUntil = (at: number): number => at + DEVICE_CERT_DAYS * DAY_MS;

export function rootLink(person: Identity, first: { pk: string; xpk: string; label: string; os: string; as: "desktop" | "phone" }, at = Date.now()): Promise<DeviceLink> {
  return sign(person, {
    kind: "kiwi-device-link" as const,
    v: 1 as const,
    person: person.pk,
    seq: 1,
    prev: null,
    at,
    op: "add" as const,
    device: first.pk,
    dxpk: first.xpk,
    label: clean(first.label, LABEL_MAX) || "a device",
    os: clean(first.os, OS_MAX),
    as: first.as,
    approve: true,
    until: certUntil(at),
  });
}

export function nextLink(list: DeviceList, signer: Identity, body: DeviceLinkBody, at = Date.now()): Promise<DeviceLink> {
  const head: LinkHead = { kind: "kiwi-device-link", v: 1, person: list.person, seq: list.version + 1, prev: list.head, at };
  const tidy: DeviceLinkBody = body.op === "add" ? { ...body, label: clean(body.label, LABEL_MAX) || "a device", os: clean(body.os, OS_MAX) } : body;
  return sign(signer, { ...head, ...tidy });
}

function shapeOf(x: Partial<DeviceLink> & Record<string, unknown>): string | null {
  if (x.kind !== "kiwi-device-link" || x.v !== 1) return "not a device link";
  if (typeof x.op !== "string" || !(x.op in FIELDS)) return "an unknown device-list op";
  if (Object.keys(x).sort().join(",") !== FIELDS[x.op as DeviceLinkBody["op"]]) return "a device link with fields it shouldn't have";
  if (typeof x.person !== "string" || !KEY_RE.test(x.person) || typeof x.pk !== "string" || !KEY_RE.test(x.pk)) return "a device link with a bad key";
  if (typeof x.device !== "string" || !KEY_RE.test(x.device) || x.device === x.person) return "a device link naming a bad device";
  if (!Number.isSafeInteger(x.seq) || !Number.isSafeInteger(x.at)) return "a device link with a bad number";
  if (x.prev !== null && typeof x.prev !== "string") return "a device link with a bad chain";
  if (x.op === "add") {
    if (typeof x.dxpk !== "string" || !KEY_RE.test(x.dxpk)) return "a device link with a bad exchange key";
    if (typeof x.label !== "string" || x.label.length > LABEL_MAX || typeof x.os !== "string" || x.os.length > OS_MAX) return "a device link with a bad label";
    if (!KINDS.includes(x.as as DeviceKind) || typeof x.approve !== "boolean") return "a device link with a bad kind";
  }
  if ((x.op === "add" || x.op === "renew") && !Number.isSafeInteger(x.until)) return "a device link with a bad expiry";
  return null;
}

export async function readDeviceList(links: readonly unknown[]): Promise<ReadList> {
  if (!links.length) return { ok: false, why: "an empty device list" };
  if (links.length > DEVICE_LIST_MAX) return { ok: false, why: "a device list longer than any person needs" };
  const devices = new Map<string, Device>();
  const revoked = new Set<string>();
  const revokes: Revoke[] = [];
  let person = "";
  let head = "";
  let version = 0;
  for (const raw of links) {
    if (!raw || typeof raw !== "object") return { ok: false, why: "not a device link" };
    const link = raw as DeviceLink;
    const bad = shapeOf(link as Partial<DeviceLink> & Record<string, unknown>);
    if (bad) return { ok: false, why: bad };
    if (!(await verify(link))) return { ok: false, why: `link ${link.seq} isn't signed by the key it names` };
    if (version === 0) {
      if (link.seq !== 1 || link.prev !== null || link.op !== "add") return { ok: false, why: "a device list starts with the person adding a first device" };
      if (link.pk !== link.person) return { ok: false, why: "a device list's first link is signed by the person key" };
      if (link.as === "computer") return { ok: false, why: "a computer can't be the first device" };
      person = link.person;
    } else {
      if (link.person !== person) return { ok: false, why: `link ${link.seq} is for another person` };
      if (link.seq !== version + 1 || link.prev !== head) return { ok: false, why: `link ${link.seq} doesn't follow link ${version}` };
      const why = refusal(link, devices, revoked, person);
      if (why) return { ok: false, why: `link ${link.seq}: ${why}` };
      if (link.op === "revoke") {
        const target = devices.get(link.device)!;
        const signer = devices.get(link.pk);
        revokes.push({ device: target.device, label: target.label, as: target.as, approve: target.approve, by: link.pk, seq: link.seq, at: link.at, older: !!signer && target.seq < signer.seq });
      }
    }
    apply(link, devices, revoked);
    version = link.seq;
    head = await digest(link);
  }
  return { ok: true, list: { person, version, head, devices: [...devices.values()], revoked: [...revoked], revokes } };
}

function refusal(link: DeviceLink, devices: ReadonlyMap<string, Device>, revoked: ReadonlySet<string>, person: string): string | null {
  const signer = devices.get(link.pk);
  const byPerson = link.pk === person;
  const approver = byPerson || (!!signer && signer.approve && signer.as !== "computer" && signer.until > link.at);
  if (!approver) return "signed by a key that may not change this person's devices";
  const target = devices.get(link.device);
  switch (link.op) {
    case "add":
      if (target || revoked.has(link.device)) return "that device is already listed, or was revoked";
      if (link.approve && link.as !== "desktop" && !byPerson) return "only a desktop is added able to approve";
      if (!(link.until > link.at && link.until <= certUntil(link.at) + DAY_MS)) return "an expiry outside 90 days";
      return null;
    case "approve":
      if (!target) return "that device isn't listed";
      if (target.as === "computer") return "a computer never approves devices";
      if (!byPerson && signer?.as !== "desktop") return "only a desktop or the person key grants approval";
      return null;
    case "renew":
      if (!target) return "that device isn't listed";
      if (!(link.until > target.until && link.until <= certUntil(link.at) + DAY_MS)) return "a renewal outside 90 days";
      return null;
    case "revoke":
      if (!target) return "that device isn't listed";
      return null;
  }
}

function apply(link: DeviceLink, devices: Map<string, Device>, revoked: Set<string>): void {
  switch (link.op) {
    case "add":
      devices.set(link.device, { device: link.device, dxpk: link.dxpk, label: link.label, os: link.os, as: link.as, approve: link.approve, until: link.until, seq: link.seq });
      return;
    case "approve": {
      const d = devices.get(link.device);
      if (d) devices.set(link.device, { ...d, approve: true });
      return;
    }
    case "renew": {
      const d = devices.get(link.device);
      if (d) devices.set(link.device, { ...d, until: link.until });
      return;
    }
    case "revoke":
      devices.delete(link.device);
      revoked.add(link.device);
      return;
  }
}

export function currentDevice(list: DeviceList, pk: string, now = Date.now()): Device | null {
  const d = list.devices.find((x) => x.device === pk);
  return d && d.until > now ? d : null;
}

export function approvingDevice(list: DeviceList, pk: string, now = Date.now()): Device | null {
  const d = currentDevice(list, pk, now);
  return d && d.approve && d.as !== "computer" ? d : null;
}

export const speaksForPerson = (list: DeviceList, pk: string, now = Date.now()): boolean => pk === list.person || !!approvingDevice(list, pk, now);

export function listedComputer(list: DeviceList, pk: string, now = Date.now()): Device | null {
  const d = currentDevice(list, pk, now);
  return d && d.as === "computer" ? d : null;
}

export const dueForRenewal = (list: DeviceList, now = Date.now()): Device[] => list.devices.filter((d) => d.until > now && d.until - now <= RENEW_WITHIN_DAYS * DAY_MS);

function newestList(a: DeviceList | undefined, b: DeviceList | undefined): DeviceList | undefined {
  if (!a || !b) return a ?? b;
  if (a.person !== b.person) throw new Error("two device lists of different people");
  return b.version > a.version ? b : a;
}

export async function newestLists(candidates: readonly unknown[], known: ReadonlyMap<string, DeviceList> = new Map()): Promise<Map<string, DeviceList>> {
  const out = new Map(known);
  for (const links of candidates) {
    if (!Array.isArray(links)) continue;
    const read = await readDeviceList(links);
    if (read.ok) out.set(read.list.person, newestList(out.get(read.list.person), read.list)!);
  }
  return out;
}

export interface DeviceClaim {
  links: DeviceLink[];
  device: string;
  vouch: string;
}

const deviceVouch = (roomId: string, memberPk: string) => `kiwi-device\n${roomId}\n${memberPk}`;

export async function claimDevice(device: Identity, links: DeviceLink[], roomId: string, memberPk: string): Promise<DeviceClaim> {
  return { links, device: device.pk, vouch: await signText(device, deviceVouch(roomId, memberPk)) };
}

interface CheckedDevice {
  person: string;
  version: number;
  device: Device;
}

export async function checkDevice(c: unknown, roomId: string, memberPk: string, newer?: (person: string) => DeviceList | undefined, now = Date.now()): Promise<CheckedDevice | null> {
  if (!c || typeof c !== "object") return null;
  const claim = c as Partial<DeviceClaim>;
  if (!Array.isArray(claim.links) || typeof claim.device !== "string" || typeof claim.vouch !== "string") return null;
  const read = await readDeviceList(claim.links);
  if (!read.ok) return null;
  const known = newer?.(read.list.person);
  const list = known && known.version > read.list.version ? known : read.list;
  const d = currentDevice(list, claim.device, now);
  if (!d) return null;
  return (await verifyText(d.device, claim.vouch, deviceVouch(roomId, memberPk))) ? { person: list.person, version: list.version, device: d } : null;
}
