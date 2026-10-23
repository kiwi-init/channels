import { expect, test } from "bun:test";
import { join } from "node:path";
import vm from "node:vm";
import { fakeHost } from "../../test/fake-host.ts";
import type { StoreSnapshot } from "../src/bridge.ts";
import { preloadSource, toPageScript } from "../src/eb-bridge.ts";
import { useHost } from "../src/host.ts";
import { handlers } from "../src/ipc/handlers.ts";
import { bunBridge } from "../src/rpc-eb.ts";
import { openStore } from "../src/store.ts";

const shell = fakeHost();
useHost(shell.host);
openStore({ where: () => "memory", load: () => ({ ok: true, file: null, resave: false }), save: () => {} });

const devkit = join(import.meta.dir, "../.hutch/devkit/api");
const built = await Bun.build({
  entrypoints: [join(import.meta.dir, "../src/preload-eb.ts")],
  target: "browser",
  plugins: [
    {
      name: "electrobun devkit",
      setup(b) {
        b.onResolve({ filter: /^electrobun\/rpc$/ }, () => ({ path: join(devkit, "sdks/main/entries/rpc.ts") }));
        b.onResolve({ filter: /^electrobun\/view$/ }, () => ({ path: join(devkit, "browser/index.ts") }));
      },
    },
  ],
});
const bundled = built.outputs[0];
if (!built.success || !bundled) throw new Error(`the preload didn't bundle: ${built.logs.join("\n")}`);
const preload = await bundled.text();

const snapshot: StoreSnapshot = { relayUrl: "https://relay.example", person: null, channels: [], computers: [], phones: [], pending: [], personalities: [] };

const HOSTILE = `
  globalThis.seen = [];
  const keep = (v, depth = 0) => {
    if (typeof v === "string") return void seen.push(v);
    if (!v || typeof v !== "object" || depth > 4) return;
    for (const k of Object.keys(v)) keep(v[k], depth + 1);
  };
  const stringify = JSON.stringify;
  JSON.stringify = function (...a) { keep(a[0]); return stringify.apply(this, a); };
  Object.defineProperty(Object.prototype, "toJSON", { configurable: true, get() { keep(this); return undefined; } });
  const regexTest = RegExp.prototype.test;
  RegExp.prototype.test = function (s) { keep(s); return regexTest.call(this, s); };
  const reflectApply = Reflect.apply;
  Reflect.apply = function (f, t, a) { keep(a); return reflectApply(f, t, a); };
  const proto = Object.getPrototypeOf(window.webkit.messageHandlers.hostBridge);
  const post = proto.postMessage;
  proto.postMessage = function (m) { keep(m); return post.call(this, m); };
  globalThis.window.__electrobunHostBridge = { postMessage: (m) => keep(m) };
  globalThis.stolen = [];
  globalThis.globalThis = { __kiwiReceive: (f) => stolen.push(f) };
`;

test("script in our page that hooks every builtin it can never sees the session id or the document's nonce, can't take main's frames, and window.kiwi keeps answering (T1855)", async () => {
  let fromPage: (frame: unknown) => void = () => {};
  const hellos: string[] = [];
  const sandbox: Record<string, unknown> = { crypto, console, TextEncoder, TextDecoder, URL, URLSearchParams, atob, btoa, setTimeout, clearTimeout, queueMicrotask };
  const handlerProto = {
    postMessage(message: string): void {
      if (!message.includes('"packet"')) hellos.push(message);
      fromPage(JSON.parse(message));
    },
  };
  const hostBridge: unknown = Object.create(handlerProto);
  sandbox["webkit"] = { messageHandlers: { hostBridge } };
  sandbox["__electrobunHostBridge"] = hostBridge;
  sandbox["window"] = sandbox;
  sandbox["self"] = sandbox;
  sandbox["top"] = sandbox;
  const realm = vm.createContext(sandbox);
  const main = bunBridge(
    handlers(shell.host),
    () => true,
    (frame) => void vm.runInContext(toPageScript(frame), realm),
  );
  main.setTransport({ registerHandler: (h) => (fromPage = h) });
  const session = main.nextSession();
  vm.runInContext(preloadSource({ snapshot, session }, preload), realm);
  vm.runInContext(HOSTILE, realm);
  vm.runInContext(
    `
    window.stores = 0;
    window.kiwi.onStore(() => window.stores++);
    window.answer = "pending";
    window.kiwi.getDeepLink().then((v) => (window.answer = v));
    window.kiwi.notify("page", "script");
  `,
    realm,
  );
  await Bun.sleep(20);
  main.push("store", snapshot);
  await Bun.sleep(20);
  const doc = (JSON.parse(hellos[0] ?? "{}") as { doc?: string }).doc ?? "";
  const seen = sandbox["seen"] as string[];
  expect(doc.length).toBeGreaterThan(15);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.filter((s) => s.includes(session) || s.includes(doc))).toEqual([]);
  expect({ answer: sandbox["answer"], stores: sandbox["stores"], stolen: sandbox["stolen"] }).toEqual({ answer: null, stores: 1, stolen: [] });
  expect(shell.did).toContain("notify page: script");
});
