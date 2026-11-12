import type { AppPath, Host } from "../desktop/src/host.ts";
import type { HostToKeys } from "../desktop/src/keys-server.ts";

export interface FakeApp {
  packaged?: boolean;
  identifier?: string;
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
      identifier: () => app.identifier ?? "com.kiwiinit.channels",
      version: () => app.version ?? "0.0.0",
      path: (name) => app.paths?.[name] ?? `/nowhere/${name}`,
      ready: () => true,
      relaunch: (execPath) => void did.push(`relaunch ${execPath}`),
      onQuit: (fn) => void quits.push(fn),
    },
    push: (name) => void did.push(`push ${name}`),
    openExternal: async (url) => void did.push(`open ${url}`),
    copyText: async () => void did.push("copy"),
    droppedFiles: async () => [],
    pastedImage: async () => null,
    badge: (count) => void did.push(`badge ${count}`),
    appearance: (appearance) => void did.push(`appearance ${appearance}`),
    wallpaper: async () => null,
    wallpaperImage: async () => null,
    windowControl: (action) => void did.push(`window ${action}`),
    accentColor: () => null,
    showWindow: () => void did.push("show"),
    reload: () => void did.push("reload"),
    restartToUpdate: () => {
      did.push("restart");
      return false;
    },
    saveDownload: async (name) => (did.push(`save ${name}`), name),
    tellKeys: (m) => void told.push(m),
  };
  return { host, did, told, quits };
}
