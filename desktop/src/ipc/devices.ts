import os from "node:os";
import type { Serves } from "../calls.ts";
import { publicPerson } from "../guard.ts";
import { publicAccess } from "../public-channel.ts";
import { createDeviceHost, createEnrollee, type DeviceHost } from "../devices.ts";
import { freshToken } from "../signin.ts";
import { mutate, store, upsertComputer } from "../store.ts";

const OS_NAMES: Partial<Record<NodeJS.Platform, string>> = { darwin: "macOS", linux: "Linux", win32: "Windows" };

const label = () => os.hostname().split(".")[0] || "this computer";
export const osName = (): string => OS_NAMES[process.platform] ?? process.platform;
const who = () => publicPerson(store.person) ?? store.enrolled ?? null;

export function storeDeviceHost(): DeviceHost {
  return createDeviceHost({
    relayUrl: () => store.relayUrl,
    token: () => freshToken(),
    person: () => (store.person ? { name: store.person.name, pk: store.person.pk, sk: store.person.sk, xpk: store.person.xpk, xsk: store.person.xsk } : null),
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
): Serves<"enrollPoll" | "enrollAnswer" | "enrollConfirm" | "enrollDeny" | "enrollBegin" | "enrollStatus" | "enrollKeep" | "enrollCancel" | "devices" | "forgetDevice" | "renewDevice" | "deviceNews"> {
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
    enrollPoll: () => host.poll(),
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
  };
}
