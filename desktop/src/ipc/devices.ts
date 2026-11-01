import os from "node:os";
import type { Serves } from "../calls.ts";
import { publicPerson } from "../guard.ts";
import { publicAccess } from "../public-channel.ts";
import { createDeviceHost, createEnrollee, type DeviceHost } from "../devices.ts";
import { createRecoverer } from "../recover.ts";
import { createRecoveryHost } from "../recovery.ts";
import { freshToken } from "../signin.ts";
import { mutate, store, upsertComputer } from "../store.ts";

const OS_NAMES: Partial<Record<NodeJS.Platform, string>> = { darwin: "macOS", linux: "Linux", win32: "Windows" };

const label = () => os.hostname().split(".")[0] || "this computer";
export const osName = (): string => OS_NAMES[process.platform] ?? process.platform;
const who = () => publicPerson(store.person) ?? store.enrolled ?? null;
const person = () => (store.person ? { name: store.person.name, pk: store.person.pk, sk: store.person.sk, xpk: store.person.xpk, xsk: store.person.xsk } : null);

export function storeDeviceHost(): DeviceHost {
  return createDeviceHost({
    relayUrl: () => store.relayUrl,
    token: () => freshToken(),
    person,
    who,
    device: () => store.device ?? null,
    saveDevice: (d) => mutate((s) => (s.device = d)),
    links: () => store.deviceLinks ?? [],
    saveLinks: (links) => mutate((s) => (s.deviceLinks = links)),
    channels: () => store.channels.flatMap((c) => (c.code ? [{ label: c.label, code: c.code }] : [])),
    computer: upsertComputer,
    label,
    os: osName,
    wipe: () =>
      mutate((s) => {
        s.device = undefined;
        s.deviceLinks = undefined;
        s.enrolled = undefined;
        s.channels = s.channels.filter((c) => publicAccess(c.access)?.ownerPk === c.pk);
        s.pending = [];
      }),
  });
}

export function devicesCalls(
  host: DeviceHost,
): Serves<
  | "enrollPoll"
  | "enrollAnswer"
  | "enrollConfirm"
  | "enrollDeny"
  | "enrollBegin"
  | "enrollStatus"
  | "enrollKeep"
  | "enrollCancel"
  | "devices"
  | "forgetDevice"
  | "renewDevice"
  | "deviceNews"
  | "recovery"
  | "recoveryWords"
  | "recoverySave"
  | "recoveryDrop"
  | "recover"
  | "recoverFinish"
  | "recoverCancel"
> {
  const recovery = createRecoveryHost({
    session: () => host.session(),
    person,
    links: () => store.deviceLinks ?? [],
    owned: () =>
      store.channels.flatMap((c) =>
        c.code && publicAccess(c.access)?.ownerPk === c.pk
          ? [{ label: c.label, code: c.code, owner: { name: c.idName ?? c.label, pk: c.pk, sk: c.sk, ...(c.xpk && c.xsk ? { xpk: c.xpk, xsk: c.xsk } : {}) } }]
          : [],
      ),
    kept: () => store.recovery ?? null,
    keep: (k) => mutate((s) => (s.recovery = k)),
  });
  const recoverer = createRecoverer({
    relayUrl: () => store.relayUrl,
    token: () => freshToken(),
    who,
    device: () => store.device ?? null,
    saveDevice: (d) => mutate((s) => (s.device = d)),
    restored: (r) =>
      mutate((s) => {
        s.person = { name: r.person.name, pk: r.person.pk, sk: r.person.sk, xpk: r.person.xpk, xsk: r.person.xsk };
        s.enrolled = undefined;
        s.deviceLinks = r.links;
        s.recovery = r.kept;
        for (const c of r.channels) {
          if (s.channels.some((h) => h.code === c.code || h.pk === c.owner.pk)) continue;
          const keys = c.owner.xpk && c.owner.xsk ? { xpk: c.owner.xpk, xsk: c.owner.xsk } : {};
          s.channels.push({ label: c.label, idName: c.owner.name, pk: c.owner.pk, sk: c.owner.sk, ...keys, code: c.code, creating: true });
        }
      }),
    label,
    os: osName,
  });
  const enrollee = createEnrollee({
    relayUrl: () => store.relayUrl,
    token: () => freshToken(),
    who,
    enrolled: (grant, device) =>
      mutate((s) => {
        s.device = device;
        s.enrolled = grant.person;
        s.deviceLinks = grant.links;
      }),
    label,
    os: osName,
  });
  return {
    enrollPoll: async () => {
      const ask = await host.poll();
      await recovery.keepCurrent().catch(() => {
        // The relay is away or another app sealed first: the owners stay unsealed here, so the next poll seals again.
      });
      return ask;
    },
    enrollAnswer: (id: string) => host.answer(id),
    enrollConfirm: (id: string, digits: string) => host.confirm(id, digits),
    enrollDeny: (id: string) => host.deny(id),
    enrollBegin: () => enrollee.begin(),
    enrollStatus: () => enrollee.status(),
    enrollKeep: () => enrollee.keep(),
    enrollCancel: () => enrollee.cancel(),
    devices: () => host.list(),
    forgetDevice: (id: string) => host.forget(id),
    renewDevice: (id: string) => host.renew(id),
    deviceNews: () => host.news(),
    recovery: () => recovery.status(),
    recoveryWords: () => recovery.words(),
    recoverySave: (typed: { at: number; word: string }[]) => recovery.save(typed),
    recoveryDrop: () => recovery.drop(),
    recover: (words: string) => recoverer.open(words),
    recoverFinish: (lost: string[]) => recoverer.finish(lost),
    recoverCancel: async () => recoverer.cancel(),
  };
}
