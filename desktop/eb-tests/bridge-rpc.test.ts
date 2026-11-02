import { describe, expect, test } from "bun:test";
import { fakeHost } from "../../test/fake-host.ts";
import type { KeysPort, KeysRequest, StoreSnapshot } from "../src/bridge.ts";
import { makeBridge, type Handlers } from "../src/calls.ts";
import type { KeysFrame } from "../src/keys-eb.ts";
import { onOurPage } from "../src/eb-bridge.ts";
import { PAGE_URL } from "../src/eb-page.ts";
import { useHost } from "../src/host.ts";
import { handlers } from "../src/ipc/handlers.ts";
import type { Frame } from "../src/eb-bridge.ts";
import { bunBridge, pageBridge, type KeysHandler } from "../src/rpc-eb.ts";
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
  () => {},
  async (session, req) => {
    keysAsked.push({ session, req });
    return { id: req.id, ok: true, value: null };
  },
);
main.setTransport({ registerHandler: (h) => (fromPage = h) });
const page = pageBridge(
  (json) => fromPage(JSON.parse(json)),
  (receive) => (toPage = receive),
  main.nextSession(),
);
const kiwi = makeBridge({ snapshot, channels, call: page.call, listen: page.listen });

const ownPage = (): ReturnType<typeof pageBridge> =>
  pageBridge(
    (json) => fromPage(JSON.parse(json)),
    (receive) => (toPage = receive),
    main.nextSession(),
  );

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
    await expect(kiwi.terminalHelpers("vim" as "rex", "on")).rejects.toThrow("terminalHelpers takes rex or tmux, and on or off");
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
    expect(await settled(page.call("constructor" as "chooseFolder"))).toBe("refused the app has no such call");
  });

  test("a reloaded page never gets the previous load's replies, and the old page's late messages get nothing", async () => {
    let release: (folder: string) => void = () => {};
    const slow = new Promise<string>((r) => (release = r));
    const table: Handlers = { ...handlers(shell.host), chooseFolder: () => slow };
    let fromAnyPage: (frame: unknown) => void = () => {};
    let toLoaded: (frame: unknown) => void = () => {};
    const opened: string[] = [];
    const reloading = bunBridge(
      table,
      () => true,
      (frame) => toLoaded(wire(frame)),
      (session) => opened.push(session),
    );
    reloading.setTransport({ registerHandler: (h) => (fromAnyPage = h) });
    const first = pageBridge(
      (json) => fromAnyPage(JSON.parse(json)),
      (receive) => (toLoaded = receive),
      reloading.nextSession(),
    );
    const before = first.call("chooseFolder");
    const second = pageBridge(
      (json) => fromAnyPage(JSON.parse(json)),
      (receive) => (toLoaded = receive),
      reloading.nextSession(),
    );
    const deep = second.call("getDeepLink");
    release("/the/previous/load's/room");
    expect(await settled(deep)).toBe("answered null");
    expect(await settled(before)).toBe("no answer");
    const done = shell.did.length;
    expect(await settled(first.call("notify", "late", "from the old page"))).toBe("no answer");
    expect(shell.did.slice(done)).toEqual([]);
    const heard: string[] = [];
    second.listen("deepLink", (u) => heard.push(u));
    reloading.push("deepLink", "kiwi://join/mc2-after-reload");
    await Bun.sleep(0);
    expect({ opened, heard }).toEqual({ opened: [first.session, second.session], heard: ["kiwi://join/mc2-after-reload"] });
  });

  test("keys: a page's request reaches main with that page's session and comes back, and main's frames reach the page", async () => {
    at = PAGE_URL;
    const kp = ownPage();
    const frames: KeysFrame[] = [];
    const off = kp.onKeys((f) => frames.push(f));
    expect(await kp.keys({ id: 4, op: "nudge" } as KeysRequest)).toEqual({ id: 4, ok: true, value: null });
    main.pushKeys({ session: kp.session, push: { sub: 1, event: null } });
    main.pushKeys({ session: kp.session, restart: true });
    main.pushKeys({ session: "an-older-page-session-id", restart: true });
    await Bun.sleep(0);
    off();
    expect({ asked: keysAsked.at(-1), frames }).toEqual({
      asked: { session: kp.session, req: { id: 4, op: "nudge" } as KeysRequest },
      frames: [
        { session: kp.session, push: { sub: 1, event: null } },
        { session: kp.session, restart: true },
      ],
    });
  });

  test("keys off our page: a request gets no answer and never reaches main, and frames aren't sent", async () => {
    at = PAGE_URL;
    const kp = ownPage();
    at = "https://evil.example/";
    const before = keysAsked.length;
    const frames: KeysFrame[] = [];
    const off = kp.onKeys((f) => frames.push(f));
    expect(await settled(kp.keys({ id: 5, op: "nudge" } as KeysRequest))).toBe("no answer");
    main.pushKeys({ session: kp.session, restart: true });
    await Bun.sleep(0);
    off();
    expect({ asked: keysAsked.length - before, frames }).toEqual({ asked: 0, frames: [] });
    at = PAGE_URL;
  });

  test("keys with a request that isn't one is refused before main's keys see it", async () => {
    at = PAGE_URL;
    const kp = ownPage();
    const before = keysAsked.length;
    for (const req of [null, {}, { id: "1" }, { id: 1.5 }, [1]]) expect(await settled(kp.keys(req as unknown as KeysRequest))).toStartWith("refused keys takes");
    expect(keysAsked.length - before).toBe(0);
  });

  test("keys across a reload: the old page's late answer never reaches the new page, which gets its own (#789 round 1)", async () => {
    let fromPage2: (packet: unknown) => void = () => {};
    let toPage2: (packet: unknown) => void = () => {};
    const answers: ((r: { id: number; ok: true; value: string }) => void)[] = [];
    const opened: string[] = [];
    const main2 = bunBridge(
      handlers(shell.host),
      () => true,
      (packet) => toPage2(wire(packet)),
      (session) => void opened.push(session),
      (_session, req) => new Promise((resolve) => answers.push((r) => resolve({ ...r, id: req.id }))),
    );
    main2.setTransport({ registerHandler: (h) => (fromPage2 = h) });
    const loadA = pageBridge(
      (json) => fromPage2(JSON.parse(json)),
      (receive) => (toPage2 = receive),
      main2.nextSession(),
    );
    const fromA = loadA.keys({ id: 1, op: "nudge" } as KeysRequest);
    const loadB = pageBridge(
      (json) => fromPage2(JSON.parse(json)),
      (receive) => (toPage2 = receive),
      main2.nextSession(),
    );
    const fromB = loadB.keys({ id: 1, op: "nudge" } as KeysRequest);
    await Bun.sleep(0);
    answers[0]?.({ id: 0, ok: true, value: "load A's answer" });
    answers[1]?.({ id: 0, ok: true, value: "load B's answer" });
    expect({ b: await settled(fromB), a: await settled(fromA), opened: opened.length }).toEqual({
      b: 'answered {"id":1,"ok":true,"value":"load B\'s answer"}',
      a: "no answer",
      opened: 2,
    });
  });
});

function rig(table: Handlers = handlers(shell.host), keys?: KeysHandler) {
  const events: string[] = [];
  const sent: Frame[] = [];
  let fromAny: (frame: unknown) => void = () => {};
  let toLoaded: (frame: unknown) => void = () => {};
  const bridge = bunBridge(
    table,
    () => true,
    (frame) => {
      sent.push(frame);
      toLoaded(wire(frame));
    },
    (session) => void events.push(`opened ${session}`),
    keys ??
      (async (session, req) => {
        events.push(`keys ${session}`);
        return { id: req.id, ok: true, value: null };
      }),
  );
  bridge.setTransport({ registerHandler: (h) => (fromAny = h) });
  const load = (session: string = bridge.nextSession()) =>
    pageBridge(
      (json) => fromAny(JSON.parse(json)),
      (receive) => (toLoaded = receive),
      session,
    );
  return { bridge, events, sent, load, raw: (frame: unknown) => fromAny(wire(frame)) };
}

describe("sessions are main's (T1230)", () => {
  test("only a session main minted opens: a thousand hellos with ids of the page's own choosing open nothing, and the real page keeps its answers", async () => {
    const r = rig();
    const real = r.load();
    for (let i = 0; i < 1000; i++) r.raw({ session: crypto.randomUUID(), doc: crypto.randomUUID() });
    r.raw({ session: crypto.randomUUID(), doc: crypto.randomUUID(), packet: { type: "request", id: 1, method: "notify", params: ["forged", "session"] } });
    expect(await settled(real.call("getDeepLink"))).toBe("answered null");
    expect(r.events).toEqual([`opened ${real.session}`]);
    expect(shell.did).not.toContain("notify forged: session");
  });

  test("main mints a fresh id for the next load each time one opens, so every load has its own", () => {
    const r = rig();
    const ids = [r.bridge.nextSession()];
    for (let i = 0; i < 3; i++) {
      r.load();
      ids.push(r.bridge.nextSession());
    }
    expect(new Set(ids).size).toBe(4);
    expect(r.events).toEqual(ids.slice(0, 3).map((id) => `opened ${id}`));
  });

  test("a retired session's late reply never leaves main, so nothing from an old load is evaluated in the new one", async () => {
    let release: (folder: string) => void = () => {};
    const slow = new Promise<string>((done) => (release = done));
    const r = rig({ ...handlers(shell.host), chooseFolder: () => slow });
    const first = r.load();
    void first.call("chooseFolder");
    const second = r.load();
    expect(await settled(second.call("getDeepLink"))).toBe("answered null");
    release("/picked/by/the/old/load");
    await Bun.sleep(10);
    expect(r.sent.filter((f) => f.session === first.session && JSON.stringify(f.packet ?? null).includes("/picked/by/the/old/load"))).toEqual([]);
  });

  test("a page's first frame can be its first keys request: its session opens before the keys see it (#789 round 3)", async () => {
    const r = rig();
    const session = r.bridge.nextSession();
    r.raw({ session, doc: crypto.randomUUID(), packet: { type: "request", id: 1, method: "keys", params: { id: 7, op: "nudge" } } });
    await Bun.sleep(10);
    expect(r.events).toEqual([`opened ${session}`, `keys ${session}`]);
  });
});

describe("each document is its own session (T1741)", () => {
  test("two documents that boot from one preload's id get their own sessions, so neither takes the other's reply", async () => {
    const picks: ((folder: string) => void)[] = [];
    const r = rig({ ...handlers(shell.host), chooseFolder: () => new Promise<string>((done) => picks.push(done)) });
    const id = r.bridge.nextSession();
    const first = r.load(id);
    const askedFirst = first.call("chooseFolder");
    const second = r.load(id);
    const askedSecond = second.call("chooseFolder");
    await Bun.sleep(0);
    picks[0]?.("/the/first/document's/dialog");
    picks[1]?.("/the/second/document's/dialog");
    expect(await settled(askedSecond)).toBe('answered "/the/second/document\'s/dialog"');
    expect(await settled(askedFirst)).toBe("no answer");
    expect(r.events).toEqual([`opened ${id}`, `opened ${id}`]);
  });

  test("load() retires the session at once: nothing for the old load leaves main before the new page says hello", async () => {
    const picks: ((folder: string) => void)[] = [];
    const r = rig({ ...handlers(shell.host), chooseFolder: () => new Promise<string>((done) => picks.push(done)) });
    const first = r.load();
    void first.call("chooseFolder");
    await Bun.sleep(0);
    r.bridge.retire();
    const before = r.sent.length;
    picks[0]?.("/the/old/load's/dialog");
    r.bridge.push("deepLink", "kiwi://join/mc2-in-the-gap");
    await Bun.sleep(10);
    expect(r.sent.slice(before)).toEqual([]);
    const second = r.load();
    expect(await settled(second.call("getDeepLink"))).toBe("answered null");
  });

  test("an id takes one second document at most: a third nonce opens nothing, so page script can retire the live session once at most, and never again without the next id", async () => {
    const r = rig();
    const id = r.bridge.nextSession();
    r.load(id);
    const second = r.load(id);
    for (let i = 0; i < 100; i++) r.raw({ session: id, doc: crypto.randomUUID(), packet: { type: "request", id: 1, method: "notify", params: ["forged", "nonce"] } });
    expect(await settled(second.call("getDeepLink"))).toBe("answered null");
    expect(r.events).toEqual([`opened ${id}`, `opened ${id}`]);
    expect(shell.did).not.toContain("notify forged: nonce");
  });
});
