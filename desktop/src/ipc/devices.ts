import os from "node:os";
import type { Serves } from "../calls.ts";
import { createDeviceHost } from "../devices.ts";
import { freshToken } from "../signin.ts";
import { mutate, store } from "../store.ts";

const OS_NAMES: Partial<Record<NodeJS.Platform, string>> = { darwin: "macOS", linux: "Linux", win32: "Windows" };

export function devicesCalls(): Serves<"enrollPoll" | "enrollAnswer" | "enrollConfirm" | "enrollDeny"> {
  const host = createDeviceHost({
    relayUrl: () => store.relayUrl,
    token: () => freshToken(),
    person: () => (store.person ? { name: store.person.name, pk: store.person.pk, sk: store.person.sk, xpk: store.person.xpk, xsk: store.person.xsk } : null),
    device: () => store.device ?? null,
    saveDevice: (d) => mutate((s) => (s.device = d)),
    links: () => store.deviceLinks ?? [],
    saveLinks: (links) => mutate((s) => (s.deviceLinks = links)),
    channels: () => store.channels.flatMap((c) => (c.code ? [{ label: c.label, code: c.code }] : [])),
    label: () => os.hostname().split(".")[0] || "this computer",
    os: () => OS_NAMES[process.platform] ?? process.platform,
  });
  return {
    enrollPoll: () => host.poll(),
    enrollAnswer: (id: string) => host.answer(id),
    enrollConfirm: (id: string, digits: string) => host.confirm(id, digits),
    enrollDeny: (id: string) => host.deny(id),
  };
}
