import os from "node:os";
import type { Serves } from "../calls.ts";
import { publicPerson } from "../guard.ts";
import { publicAccess } from "../public-channel.ts";
import { createDeviceHost, createEnrollee } from "../devices.ts";
import { freshToken } from "../signin.ts";
import { mutate, store } from "../store.ts";

const OS_NAMES: Partial<Record<NodeJS.Platform, string>> = { darwin: "macOS", linux: "Linux", win32: "Windows" };

export function devicesCalls(): Serves<
  "enrollPoll" | "enrollAnswer" | "enrollConfirm" | "enrollDeny" | "enrollBegin" | "enrollStatus" | "enrollCancel" | "devices" | "forgetDevice" | "renewDevice" | "deviceNews"
> {
  const label = () => os.hostname().split(".")[0] || "this computer";
  const osName = () => OS_NAMES[process.platform] ?? process.platform;
  const who = () => publicPerson(store.person) ?? store.enrolled ?? null;
  const host = createDeviceHost({
    relayUrl: () => store.relayUrl,
    token: () => freshToken(),
    person: () => (store.person ? { name: store.person.name, pk: store.person.pk, sk: store.person.sk, xpk: store.person.xpk, xsk: store.person.xsk } : null),
    who,
    device: () => store.device ?? null,
    saveDevice: (d) => mutate((s) => (s.device = d)),
    links: () => store.deviceLinks ?? [],
    saveLinks: (links) => mutate((s) => (s.deviceLinks = links)),
    channels: () => store.channels.flatMap((c) => (c.code ? [{ label: c.label, code: c.code }] : [])),
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
  const enrollee = createEnrollee({
    relayUrl: () => store.relayUrl,
    token: () => freshToken(),
    who,
    device: () => store.device ?? null,
    saveDevice: (d) => mutate((s) => (s.device = d)),
    enrolled: (grant) =>
      mutate((s) => {
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
    enrollCancel: () => enrollee.cancel(),
    devices: () => host.list(),
    forgetDevice: (id: string) => host.forget(id),
    renewDevice: (id: string) => host.renew(id),
    deviceNews: () => host.news(),
  };
}
