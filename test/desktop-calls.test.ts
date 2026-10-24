import { describe, expect, test } from "bun:test";
import { DEFAULT_RELAY } from "@kiwi/core/relay-url.ts";
import type { KeysPort, KiwiBridge, StoreSnapshot } from "../desktop/src/bridge.ts";
import { makeBridge, type BridgeTransport, type Call, type CallArgs, type CallValue, type Handlers, type Push, type Pushes } from "../desktop/src/calls.ts";
import { useHost } from "../desktop/src/host.ts";
import { handlers } from "../desktop/src/ipc/handlers.ts";
import { openStore, store, type StoreFile } from "../desktop/src/store.ts";
import { fakeHost } from "./fake-host.ts";

const shell = fakeHost();
useHost(shell.host);
const saved: StoreFile[] = [];
openStore({ where: () => "memory", load: () => ({ ok: true, file: null, resave: false }), save: (file) => void saved.push(structuredClone(file)) });

const snapshot: StoreSnapshot = { relayUrl: "https://relay.example", person: null, channels: [], computers: [], phones: [], pending: [], personalities: [] };
const channels: KeysPort = { request: () => new Promise(() => {}), onPush: () => () => {}, onRestart: () => () => {} };

interface Pushed {
  subs: Map<Push, Set<(value: never) => void>>;
  emit<P extends Push>(name: P, value: Pushes[P]): void;
  listen: BridgeTransport["listen"];
}

function pushes(): Pushed {
  const subs = new Map<Push, Set<(value: never) => void>>();
  return {
    subs,
    emit: (name, value) => {
      for (const cb of subs.get(name) ?? []) (cb as (v: typeof value) => void)(value);
    },
    listen: (name, cb) => {
      const set = subs.get(name) ?? new Set();
      set.add(cb);
      subs.set(name, set);
      return () => void set.delete(cb);
    },
  };
}

function inProcess(table: Handlers): BridgeTransport["call"] {
  return function call<K extends Call>(name: K, ...args: CallArgs<K>): Promise<CallValue<K>> {
    const fn: Handlers[K] = table[name];
    return Promise.resolve().then(() => fn(...args));
  };
}

describe("window.kiwi on any transport", () => {
  test("every call goes out under its own name with its arguments, and main has exactly one handler for each", async () => {
    const seen: { name: Call; args: unknown[] }[] = [];
    const bridge = makeBridge({
      snapshot,
      channels,
      listen: pushes().listen,
      call: (name, ...args) => {
        seen.push({ name, args });
        return Promise.reject(new Error(name));
      },
    });
    const isCall = (key: keyof KiwiBridge): key is Call => typeof bridge[key] === "function" && key !== "getSnapshot" && !/^on[A-Z]/.test(key);
    const called: Call[] = [];
    for (const name of (Object.keys(bridge) as (keyof KiwiBridge)[]).filter(isCall)) {
      const out: unknown = Reflect.apply(bridge[name], bridge, [`${name} 1`, `${name} 2`]);
      await expect(out).rejects.toThrow(name);
      called.push(name);
    }
    expect(seen.map((s) => s.name)).toEqual(called);
    for (const s of seen) for (const arg of s.args) expect(String(arg).startsWith(`${s.name} `)).toBe(true);
    expect(seen.find((s) => s.name === "foldersOn")?.args).toEqual(["foldersOn 1", "foldersOn 2"]);
    expect(Object.keys(handlers(shell.host)).sort()).toEqual([...called].sort());
  });

  test("each on* hears its own push, stops when unsubscribed, and getSnapshot follows store pushes", () => {
    const bus = pushes();
    const bridge = makeBridge({ snapshot, channels, listen: bus.listen, call: () => Promise.reject(new Error("no calls here")) });
    const heard: string[] = [];
    const offs = [
      bridge.onStore((s) => heard.push(`store ${s.relayUrl}`)),
      bridge.onUpdate((u) => heard.push(`update ${u.version}`)),
      bridge.onGithubCode((c) => heard.push(`githubCode ${c.code}`)),
      bridge.onDeepLink((url) => heard.push(`deepLink ${url}`)),
      bridge.onTextStep((step) => heard.push(`textStep ${step}`)),
    ];
    const moved = { ...snapshot, relayUrl: "https://moved.example" };
    bus.emit("store", moved);
    bus.emit("update", { version: "0.27.0", state: "ready", url: "https://github.com/kiwi-init/channels/releases/tag/v0.27.0" });
    bus.emit("githubCode", { code: "ABCD-1234", url: "https://github.com/login/device" });
    bus.emit("deepLink", "kiwi://join/mc2-abc");
    bus.emit("textStep", "bigger");
    expect(heard).toEqual(["store https://moved.example", "update 0.27.0", "githubCode ABCD-1234", "deepLink kiwi://join/mc2-abc", "textStep bigger"]);
    expect(bridge.getSnapshot()).toBe(moved);
    expect(bridge.relayUrl).toBe("https://relay.example");
    for (const off of offs) off();
    bus.emit("deepLink", "kiwi://join/mc2-later");
    expect(heard).toHaveLength(5);
    expect(bus.subs.get("store")?.size).toBe(1);
  });
});

describe("main's handlers reach the shell only through the host", () => {
  const { host, did, told } = shell;
  const bus = pushes();
  const bridge = makeBridge({ snapshot, channels, listen: bus.listen, call: inProcess(handlers(host)) });

  test("the folder picker, notifications and the update restart are the host's", async () => {
    expect(await bridge.chooseFolder()).toBe("/Users/someone/app");
    await bridge.notify("T484", "done");
    await bridge.installUpdate();
    expect(did).toEqual(["notify T484: done", "restart"]);
  });

  test("a link that isn't http(s) never reaches the host's browser", async () => {
    did.length = 0;
    await expect(bridge.openExternal("file:///etc/passwd")).rejects.toThrow("only http(s) links open outside");
    expect(did).toEqual([]);
  });

  test("a new relay is saved, told to the keys and reloads the page; a bad one changes nothing", async () => {
    did.length = 0;
    await expect(bridge.setRelayUrl("ftp://relay.example")).rejects.toThrow("that isn't a relay URL");
    expect({ did, told, relay: store.relayUrl }).toEqual({ did: [], told: [], relay: DEFAULT_RELAY });
    expect(await bridge.setRelayUrl("https://relay.example/")).toBe("https://relay.example");
    expect({ did, told, relay: store.relayUrl }).toEqual({
      did: ["push store", "reload"],
      told: [
        { type: "seats", seats: [], person: null },
        { type: "relay", relay: "https://relay.example" },
      ],
      relay: "https://relay.example",
    });
    expect(saved.at(-1)?.relayUrl).toBe("https://relay.example");
  });

  test("a bad argument is refused under the call's name before anything runs", async () => {
    await expect(bridge.terminalPrefer("vim" as "app")).rejects.toThrow("terminalPrefer takes app, rex or tmux");
    await expect(bridge.setLaunches("maybe" as "on")).rejects.toThrow("setLaunches takes on or off");
  });
});
