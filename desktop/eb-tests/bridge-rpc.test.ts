import { describe, expect, test } from "bun:test";
import { fakeHost } from "../../test/fake-host.ts";
import type { KeysPort, StoreSnapshot } from "../src/bridge.ts";
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
const main = bunBridge(
  handlers(shell.host),
  () => onOurPage(at),
  (packet) => toPage(wire(packet)),
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
});
