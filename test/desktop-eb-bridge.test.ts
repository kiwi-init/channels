import { describe, expect, test } from "bun:test";
import type { StoreSnapshot } from "../desktop/src/bridge.ts";
import type { Handlers } from "../desktop/src/calls.ts";
import {
  answer,
  BOOT_GLOBAL,
  committedUrl,
  frameOf,
  stillOurs,
  lockInternalRpc,
  onOurPage,
  PAGE_INTERNAL_RPC,
  pageOnly,
  preloadSource,
  RECEIVE_GLOBAL,
  toPageScript,
} from "../desktop/src/eb-bridge.ts";
import { PAGE_URL } from "../desktop/src/eb-page.ts";
import { useHost } from "../desktop/src/host.ts";
import { handlers } from "../desktop/src/ipc/handlers.ts";
import { fakeHost } from "./fake-host.ts";

const shell = fakeHost();
useHost(shell.host);
const table: Handlers = handlers(shell.host);

describe("which page the Electrobun view is on", () => {
  test("only our own page counts, whatever its hash", () => {
    expect(onOurPage(PAGE_URL)).toBe(true);
    expect(onOurPage(`${PAGE_URL}#mc2-abc`)).toBe(true);
    for (const off of [null, "", "views://internal/other.html", "views://internal/index.html?x=1", "views://evil/index.html", "https://evil.example/", "about:blank", "file:///etc/passwd"])
      expect(onOurPage(off)).toBe(false);
  });

  test("a navigation event can only take the bridge away from the view, never give it back: the page can post such events itself", () => {
    expect(stillOurs(true, PAGE_URL)).toBe(true);
    expect(stillOurs(true, `${PAGE_URL}#mc2-abc`)).toBe(true);
    expect(stillOurs(true, "https://evil.example/")).toBe(false);
    expect(stillOurs(true, null)).toBe(false);
    expect(stillOurs(false, PAGE_URL)).toBe(false);
    let ours = true;
    for (const url of [PAGE_URL, "about:blank", PAGE_URL, `${PAGE_URL}#x`]) ours = stillOurs(ours, url);
    expect(ours).toBe(false);
  });

  test("a navigation event's detail names the page, as a string or WebKit's JSON", () => {
    expect(committedUrl(PAGE_URL)).toBe(PAGE_URL);
    expect(committedUrl(JSON.stringify({ url: "https://evil.example/" }))).toBe("https://evil.example/");
    for (const junk of [undefined, null, 7, { url: PAGE_URL }, "{not json", JSON.stringify({ href: PAGE_URL })]) expect(committedUrl(junk)).toBeNull();
  });
});

describe("the bridge answers only our page", () => {
  test("a frame names its page load by a session id; a hello has no packet, and anything else isn't a frame", () => {
    const session = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
    expect(frameOf({ session })).toEqual({ session });
    expect(frameOf({ session, packet: { type: "request", id: 1 } })).toEqual({ session, packet: { type: "request", id: 1 } });
    expect(frameOf({ session, packet: null })).toEqual({ session, packet: null });
    for (const junk of [null, "x", { packet: {} }, { session: 7 }, { session: "short" }, { session: "has space in it, quite long" }, { session: "a".repeat(65) }]) expect(frameOf(junk)).toBeNull();
  });

  test("off our page, nothing comes in and nothing goes out", () => {
    let on = true;
    const sent: unknown[] = [];
    const heard: unknown[] = [];
    let deliver: (packet: unknown) => void = () => {};
    const t = pageOnly({ send: (p) => void sent.push(p), registerHandler: (h) => (deliver = h) }, () => on);
    t.registerHandler?.((p) => heard.push(p));
    deliver("in 1");
    t.send?.("out 1");
    on = false;
    deliver("in 2");
    t.send?.("out 2");
    on = true;
    deliver("in 3");
    expect({ heard, sent }).toEqual({ heard: ["in 1", "in 3"], sent: ["out 1"] });
  });

  test("a call that isn't the bridge's, or not given as a list, never reaches a handler", async () => {
    for (const method of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "nope", 7, null]) await expect(answer(table, method, [])).rejects.toThrow("the app has no such call");
    await expect(answer(table, "notify", "T436")).rejects.toThrow("notify takes its arguments as a list");
    expect(shell.did).toEqual([]);
  });

  test("a bridge call runs its handler with its arguments, and a handler's throw comes back as a rejection", async () => {
    await answer(table, "notify", ["T436", "done"]);
    expect(await answer(table, "chooseFolder", [])).toBe("/Users/someone/app");
    await expect(answer(table, "terminalPrefer", ["vim"])).rejects.toThrow("terminalPrefer takes app, rex or tmux");
    expect(shell.did).toEqual(["notify T436: done"]);
  });
});

describe("what main sends the page", () => {
  test("the preload carries the snapshot, and packets go only to our own receiver", () => {
    const snapshot: StoreSnapshot = { relayUrl: "https://relay.example", person: null, channels: [], computers: [], phones: [], pending: [], personalities: [] };
    const source = preloadSource({ ...snapshot, pending: [{ id: "1", at: 1, title: "line break </script>", body: null }] }, "bundle();");
    const page: Record<string, unknown> = {};
    new Function("globalThis", source.replace("bundle();", ""))(page);
    expect((page[BOOT_GLOBAL] as StoreSnapshot).pending[0]?.title).toBe("line break </script>");
    expect(source.endsWith("bundle();")).toBe(true);
    const got: unknown[] = [];
    new Function("globalThis", toPageScript({ type: "message", id: "store", payload: { a: " " } }))({ [RECEIVE_GLOBAL]: (p: unknown) => got.push(p) });
    new Function("globalThis", toPageScript({ type: "message" }))({});
    expect(got).toEqual([{ type: "message", id: "store", payload: { a: " " } }]);
  });
});

describe("Electrobun's internal RPC on our view", () => {
  test("every page-reachable handler but window dragging does nothing, the three that move or script the view included", () => {
    const ran: string[] = [];
    const named = (name: string) => () => void ran.push(name);
    const rpc = {
      request: { webviewTagInit: named("webviewTagInit"), webviewTagCanGoBack: named("webviewTagCanGoBack"), restoreWindowFocusAfterExternalDrop: named("restoreWindowFocusAfterExternalDrop") },
      message: {
        webviewTagUpdateSrc: named("webviewTagUpdateSrc"),
        webviewTagSetNavigationRules: named("webviewTagSetNavigationRules"),
        webviewTagExecuteJavascript: named("webviewTagExecuteJavascript"),
        webviewTagUpdatePreload: named("webviewTagUpdatePreload"),
        webviewTagRemove: named("webviewTagRemove"),
        webviewTagOpenDevTools: named("webviewTagOpenDevTools"),
        startWindowMove: named("startWindowMove"),
        stopWindowMove: named("stopWindowMove"),
      },
    };
    const dropped = lockInternalRpc(rpc);
    for (const table of [rpc.request, rpc.message]) for (const fn of Object.values(table)) fn();
    expect(ran.sort()).toEqual(["restoreWindowFocusAfterExternalDrop", "startWindowMove", "stopWindowMove"]);
    expect(dropped).toContain("webviewTagUpdateSrc");
    expect(dropped).toContain("webviewTagSetNavigationRules");
    expect(dropped).toContain("webviewTagExecuteJavascript");
    expect([...PAGE_INTERNAL_RPC].sort()).toEqual(["restoreWindowFocusAfterExternalDrop", "startWindowMove", "stopWindowMove"]);
  });
});
