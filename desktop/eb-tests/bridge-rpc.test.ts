import { describe, expect, test } from "bun:test";
import { fakeHost } from "../../test/fake-host.ts";
import type { KeysPort, KeysRequest, StoreSnapshot } from "../src/bridge.ts";
import type { KeysFrame } from "../src/keys-eb.ts";
import { makeBridge } from "../src/calls.ts";
import { onOurPage } from "../src/eb-bridge.ts";
import { PAGE_URL } from "../src/eb-page.ts";
import { useHost } from "../src/host.ts";
import { handlers } from "../src/ipc/handlers.ts";
import { bunBridge, pageBridge } from "../src/rpc-eb.ts";
import { openStore } from "../src/store.ts";

const shell = fakeHost();
useHost(shell.host);
openStore({ where: () => "memory", load: () => ({ ok: true, file: null, resave: false }), save: () => {} });

const wire = (packet: unknown): unknown => JSON.parse(JSON.stringify(packet)) as unknown;
const snapshot: StoreSnapshot = { relayUrl: "https://relay.example", person: null, channels: [], computers: [], phones: [], pending: [], personalities: [] };
const channels: KeysPort = { request: () => new Promise(() => {}), onPush: () => () => {}, onRestart: () => () => {} };

let at: string | null = PAGE_URL;
let fromPage: (packet: unknown) => void = () => {};
let toPage: (packet: unknown) => void = () => {};
const keysAsked: { session: string; req: KeysRequest }[] = [];
const main = bunBridge(
  handlers(shell.host),
  () => onOurPage(at),
  (packet) => toPage(wire(packet)),
  async (session, req) => {
    keysAsked.push({ session, req });
    return { id: req.id, ok: true, value: null };
  },
);
main.setTransport({ registerHandler: (h) => (fromPage = h) });
const page = pageBridge(
  (packet) => fromPage(wire(packet)),
  (receive) => (toPage = receive),
);
const kiwi = makeBridge({ snapshot, channels, call: page.call, listen: page.listen });

const settled = (p: Promise<unknown>, ms = 100): Promise<string> =>
  Promise.race([
    p.then(
      (v) => `answered ${JSON.stringify(v)}`,
      (e: unknown) => `refused ${e instanceof Error ? e.message : String(e)}`,
    ),
    new Promise<string>((r) => setTimeout(() => r("no answer"), ms)),
  ]);

describe("window.kiwi over Electrobun's RPC, both ends as the app wires them", () => {
  test("calls reach main's handlers with their arguments, and answers and errors come back", async () => {
    await kiwi.notify("T436", "over RPC");
    expect(await kiwi.chooseFolder()).toBe("/Users/someone/app");
    await expect(kiwi.terminalPrefer("vim" as "app")).rejects.toThrow("terminalPrefer takes app, rex or tmux");
    await expect(kiwi.openExternal("file:///etc/passwd")).rejects.toThrow("only http(s) links open outside");
    expect(shell.did).toEqual(["notify T436: over RPC"]);
  });

  test("a store change reaches the page's onStore and getSnapshot, and other pushes their own listener", async () => {
    const stores: string[] = [];
    const off = kiwi.onStore((s) => stores.push(s.relayUrl));
    main.push("store", { ...snapshot, relayUrl: "https://moved.example" });
    const links: string[] = [];
    kiwi.onDeepLink((u) => links.push(u));
    main.push("deepLink", "kiwi://join/mc2-abc");
    await Bun.sleep(0);
    expect({ stores, links, now: kiwi.getSnapshot().relayUrl }).toEqual({ stores: ["https://moved.example"], links: ["kiwi://join/mc2-abc"], now: "https://moved.example" });
    off();
  });

  test("a view moved off our page gets no answers and no pushes, and answers again once it's back", async () => {
    at = "https://evil.example/";
    const before = shell.did.length;
    const heard: string[] = [];
    kiwi.onDeepLink((u) => heard.push(u));
    expect(await settled(kiwi.chooseFolder())).toBe("no answer");
    expect(await settled(kiwi.notify("off", "page"))).toBe("no answer");
    main.push("deepLink", "kiwi://join/mc2-leak");
    await Bun.sleep(0);
    expect({ ran: shell.did.slice(before), heard }).toEqual({ ran: [], heard: [] });
    at = `${PAGE_URL}#mc2-abc`;
    expect(await settled(kiwi.chooseFolder())).toBe('answered "/Users/someone/app"');
  });

  test("a call that isn't the bridge's is refused before any handler", async () => {
    at = PAGE_URL;
    const loose = pageBridge(
      (packet) => fromPage(wire(packet)),
      (receive) => (toPage = receive),
    );
    expect(await settled(loose.call("constructor" as "chooseFolder"))).toBe("refused the app has no such call");
  });

  test("keys: a page's request reaches main with its session and comes back, and main's frames reach the page", async () => {
    at = PAGE_URL;
    const session = "0123456789abcdef0123456789abcdef";
    const frames: KeysFrame[] = [];
    const off = page.onKeys((f) => frames.push(f));
    expect(await page.keys(session, { id: 4, op: "nudge" } as KeysRequest)).toEqual({ id: 4, ok: true, value: null });
    main.pushKeys({ session, push: { sub: 1, event: null } });
    main.pushKeys({ session, restart: true });
    await Bun.sleep(0);
    off();
    expect({ asked: keysAsked.at(-1), frames }).toEqual({
      asked: { session, req: { id: 4, op: "nudge" } as KeysRequest },
      frames: [
        { session, push: { sub: 1, event: null } },
        { session, restart: true },
      ],
    });
  });

  test("keys off our page: a request gets no answer and never reaches main, and frames aren't sent", async () => {
    at = "https://evil.example/";
    const before = keysAsked.length;
    const frames: KeysFrame[] = [];
    const off = page.onKeys((f) => frames.push(f));
    expect(await settled(page.keys("0123456789abcdef0123456789abcdef", { id: 5, op: "nudge" } as KeysRequest))).toBe("no answer");
    main.pushKeys({ session: "0123456789abcdef0123456789abcdef", restart: true });
    await Bun.sleep(0);
    off();
    expect({ asked: keysAsked.length - before, frames }).toEqual({ asked: 0, frames: [] });
    at = PAGE_URL;
  });

  test("keys with a session or request that isn't one is refused before main's keys see it", async () => {
    at = PAGE_URL;
    const before = keysAsked.length;
    for (const [session, req] of [
      ["short", { id: 1 }],
      ["0123456789abcdef0123456789abcdef!", { id: 1 }],
      ["0123456789abcdef0123456789abcdef", null],
      ["0123456789abcdef0123456789abcdef", { id: "1" }],
      ["0123456789abcdef0123456789abcdef", [1]],
    ] as const)
      expect(await settled(page.keys(session, req as unknown as KeysRequest))).toStartWith("refused keys takes");
    expect(keysAsked.length - before).toBe(0);
  });
});
