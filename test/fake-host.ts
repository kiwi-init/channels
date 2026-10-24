import type { AppPath, Host } from "../desktop/src/host.ts";
import type { HostToKeys } from "../desktop/src/keys-server.ts";

export interface FakeApp {
  packaged?: boolean;
  version?: string;
  paths?: Partial<Record<AppPath, string>>;
}

export interface FakeHost {
  host: Host;
  did: string[];
  told: HostToKeys[];
  quits: (() => void)[];
}

export function fakeHost(app: FakeApp = {}): FakeHost {
  const did: string[] = [];
  const told: HostToKeys[] = [];
  const quits: (() => void)[] = [];
  const host: Host = {
    app: {
      packaged: () => app.packaged ?? false,
      version: () => app.version ?? "0.0.0",
      path: (name) => app.paths?.[name] ?? `/nowhere/${name}`,
      ready: () => true,
      relaunch: (execPath) => void did.push(`relaunch ${execPath}`),
      onQuit: (fn) => void quits.push(fn),
    },
    push: (name) => void did.push(`push ${name}`),
    openExternal: async (url) => void did.push(`open ${url}`),
    pickFolder: async () => "/Users/someone/app",
    droppedFiles: async () => [],
    pastedImage: async () => null,
    notify: (title, body) => void did.push(`notify ${title}: ${body}`),
    badge: (count) => void did.push(`badge ${count}`),
    showWindow: () => void did.push("show"),
    reload: () => void did.push("reload"),
    restartToUpdate: () => void did.push("restart"),
    tellKeys: (m) => void told.push(m),
  };
  return { host, did, told, quits };
}
