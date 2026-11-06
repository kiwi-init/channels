import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModView } from "../desktop/src/bridge.ts";
import { modSource, modsHost, type ModsHostOptions } from "../desktop/src/mods-host.ts";
import { SAFE_FILE, SAFE_LOOP } from "../desktop/src/mods.ts";

const roots: string[] = [];
const stops: (() => void)[] = [];

function setup(extra: Partial<ModsHostOptions> = {}) {
  const root = mkdtempSync(join(tmpdir(), "kiwi-mods-host-"));
  roots.push(root);
  const pushed: ModView[][] = [];
  const folder = join(root, ".kiwi", "mods");
  const host = modsHost({ folder, approvals: join(root, "data", "mods.json"), contract: "3.3.0", push: (l) => pushed.push(l), ...extra });
  stops.push(() => host.stop());
  const write = (name: string, files: Record<string, string>) => {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(join(folder, name, file, ".."), { recursive: true });
      writeFileSync(join(folder, name, file), text);
    }
  };
  return { root, folder, host, pushed, write };
}

const linear = {
  "mod.json": JSON.stringify({ name: "linear", version: "1.0.0", shell: "^3.3", needs: ["panel", "net:api.linear.app"] }),
  "index.tsx": `import { panel } from "@kiwi/mod"\npanel({ title: "Linear" })\n`,
};

afterEach(() => {
  for (const s of stops.splice(0)) s();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("the app's mods", () => {
  test("with no mods folder the app has none, and says so once", async () => {
    const { host, pushed } = setup();
    await host.start();
    expect(host.list()).toEqual([]);
    expect(pushed).toEqual([[]]);
  });

  test("a new mod waits for the person to approve what it needs, and nothing of it runs until then", async () => {
    const { host, write } = setup();
    write("linear", linear);
    await host.start();
    expect(host.list()).toEqual([{ name: "linear", version: "1.0.0", source: "local", needs: ["panel", "net:api.linear.app"], approved: [], state: "asks" }]);
    expect(host.bundle("linear")).toBeNull();
    await expect(host.fetch("linear", { url: "https://api.linear.app/graphql" })).rejects.toThrow("isn't running");
  });

  test("approving exactly what it asks starts it, kept in a private file; approving less or more is refused", async () => {
    const { root, host, write } = setup();
    write("linear", linear);
    await host.start();
    await expect(host.approve("linear", ["panel"])).rejects.toThrow("approve exactly what linear asks for");
    await expect(host.approve("linear", ["panel", "net:api.linear.app", "net:evil.com"])).rejects.toThrow("approve exactly");
    const after = await host.approve("linear", ["net:api.linear.app", "panel"]);
    expect(after[0]?.state).toBe("on");
    expect(after[0]?.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(host.bundle("linear")?.code).toContain("__kiwiMod");
    expect(statSync(join(root, "data", "mods.json")).mode & 0o777).toBe(0o600);
  });

  test("a mod that adds a need after approval asks again", async () => {
    const { host, write } = setup();
    write("linear", linear);
    await host.start();
    await host.approve("linear", ["panel", "net:api.linear.app"]);
    write("linear", { "mod.json": JSON.stringify({ name: "linear", version: "1.1.0", shell: "^3.3", needs: ["panel", "net:api.linear.app", "net:evil.example.com"] }) });
    await host.rescan();
    expect(host.list()[0]).toMatchObject({ state: "asks", approved: ["panel", "net:api.linear.app"] });
    expect(host.bundle("linear")).toBeNull();
  });

  test("a mod that doesn't fit is off with its reason, and the others still load", async () => {
    const { host, write } = setup();
    write("old", { "mod.json": JSON.stringify({ name: "old", version: "1.0.0", shell: "^2.0", needs: [] }), "index.ts": "" });
    write("broken", { "mod.json": "{ not json" });
    write("plain", { "mod.json": JSON.stringify({ name: "plain", version: "1.0.0", shell: "^3.3" }), "index.ts": "export {}" });
    await host.start();
    expect(host.list().map((m) => [m.name, m.state, m.why])).toEqual([
      ["broken", "off", "its mod.json isn't JSON"],
      ["old", "off", "it needs shell ^2.0, and this app offers 3.3.0"],
      ["plain", "on", undefined],
    ]);
  });

  test("its fetch goes out only to an approved host, without cookies, and doesn't follow redirects", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const request = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response("hello", { status: 200, headers: { "content-type": "text/plain", "set-cookie": "a=b" } });
    }) as unknown as typeof fetch;
    const { host, write } = setup({ request });
    write("linear", linear);
    await host.start();
    await host.approve("linear", ["panel", "net:api.linear.app"]);
    const r = await host.fetch("linear", { url: "https://api.linear.app/graphql", method: "post", headers: { authorization: "Bearer x", cookie: "s=1", Host: "evil" }, body: "{}" });
    expect(r).toEqual({ status: 200, statusText: "", headers: { "content-type": "text/plain" }, body: Buffer.from("hello").toString("base64") });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.init.redirect).toBe("manual");
    expect(seen[0]?.init.method).toBe("POST");
    const headers = seen[0]?.init.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer x");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("host")).toBeNull();
    await expect(host.fetch("linear", { url: "https://evil.example.com/" })).rejects.toThrow("its host isn't one it listed and you approved");
    await expect(host.fetch("linear", { url: "http://api.linear.app/" })).rejects.toThrow("isn't one it listed");
    await expect(host.fetch("linear", { url: "https://api.linear.app/", method: "CONNECT" })).rejects.toThrow("may not send a CONNECT request");
    expect(seen).toHaveLength(1);
  });

  test("saving a mod's file rebuilds it and tells the page", async () => {
    const { host, pushed, write } = setup();
    write("plain", { "mod.json": JSON.stringify({ name: "plain", version: "1.0.0", shell: "^3.3" }), "index.ts": "console.log(1)" });
    await host.start();
    const first = host.list()[0]?.hash;
    const before = pushed.length;
    write("plain", { "index.ts": "console.log(2)" });
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && (pushed.length === before || host.list()[0]?.hash === first)) await Bun.sleep(50);
    expect(host.list()[0]?.hash).not.toBe(first);
    expect(pushed.length).toBeGreaterThan(before);
  });

  test("an approval holds for the source it was given: the same name from another source asks again, an update from the same one doesn't", async () => {
    const { root, host, write } = setup();
    write("linear", { ...linear, ".git/config": "[core]\n\tbare = false\n[kiwi]\n\tsource = alice/linear\n" });
    await host.start();
    expect(host.list()[0]?.source).toBe("alice/linear");
    await host.approve("linear", ["panel", "net:api.linear.app"]);
    expect(JSON.parse(readFileSync(join(root, "data", "mods.json"), "utf8")).approved).toEqual({ linear: { needs: ["net:api.linear.app", "panel"], source: "alice/linear" } });
    write("linear", { "index.tsx": `import { panel } from "@kiwi/mod"\npanel({ title: "Linear 2" })\n` });
    await host.rescan();
    expect(host.list()[0]?.state).toBe("on");
    write("linear", { ".git/config": "[kiwi]\n\tsource = mallory/linear\n" });
    await host.rescan();
    expect(host.list()[0]).toMatchObject({ state: "asks", source: "mallory/linear", approved: [], why: "It comes from mallory/linear now, not alice/linear." });
    expect(host.bundle("linear")).toBeNull();
  });

  test("approvals saved by name alone ask again", async () => {
    const { root, host, write } = setup();
    write("linear", linear);
    mkdirSync(join(root, "data"), { recursive: true });
    writeFileSync(join(root, "data", "mods.json"), JSON.stringify({ approved: { linear: ["panel", "net:api.linear.app"] } }));
    await host.start();
    expect(host.list()[0]?.state).toBe("asks");
  });

  test("a mod's source is kiwi.source in its clone's git config, and local without one", () => {
    const root = mkdtempSync(join(tmpdir(), "kiwi-mod-source-"));
    roots.push(root);
    const config = (text: string | null) => {
      rmSync(join(root, ".git"), { recursive: true, force: true });
      if (text === null) return modSource(root);
      mkdirSync(join(root, ".git"));
      writeFileSync(join(root, ".git", "config"), text);
      return modSource(root);
    };
    expect(config(null)).toBe("local");
    expect(config('[remote "origin"]\n\turl = https://github.com/a/b\n')).toBe("local");
    expect(config("[Kiwi]\n\tSource = owner/repo ; a comment\n")).toBe("owner/repo");
    expect(config('[kiwi]\n\tsource = "https://example.com/a b#c"\n')).toBe("https://example.com/a b#c");
    expect(config('[kiwi "other"]\n\tsource = not/this\n[kiwi]\n\tref = main\n')).toBe("local");
    expect(config("[kiwi]\n\tsource = first/one\n[kiwi]\n\tsource = last/one\n")).toBe("last/one");
  });

  test("a mod that fails as it starts is off with its reason, until its code changes or the person switches it on", async () => {
    const { host, write } = setup();
    write("linear", linear);
    await host.start();
    await host.approve("linear", ["panel", "net:api.linear.app"]);
    const hash = host.list()[0]?.hash ?? "";
    await host.failed("linear", "0000000000000000", "TypeError: from older code");
    expect(host.list()[0]?.state).toBe("on");
    await host.failed("linear", hash, "\nTypeError: boom\n@views://internal/mod-frame.html:1:2");
    expect(host.list()[0]).toMatchObject({ state: "off", off: "crash", why: "It stopped as it started: TypeError: boom" });
    expect(host.bundle("linear")).toBeNull();
    await host.rescan();
    expect(host.list()[0]?.off).toBe("crash");
    write("linear", { "index.tsx": `import { panel } from "@kiwi/mod"\npanel({ title: "Fixed" })\n` });
    await host.rescan();
    expect(host.list()[0]?.state).toBe("on");
    const fixed = host.list()[0]?.hash ?? "";
    await host.failed("linear", fixed, "Error: again");
    expect(host.list()[0]?.off).toBe("crash");
    await host.setOn("linear", true);
    expect(host.list()[0]).toMatchObject({ state: "on", hash: fixed });
  });

  test("a mod the person switches off stays off across restarts, and comes back when switched on", async () => {
    const { root, host, write } = setup();
    write("linear", linear);
    await host.start();
    await host.approve("linear", ["panel", "net:api.linear.app"]);
    await host.setOn("linear", false);
    expect(host.list()[0]).toMatchObject({ state: "off", off: "you" });
    expect(host.bundle("linear")).toBeNull();
    host.stop();
    const again = modsHost({ folder: join(root, ".kiwi", "mods"), approvals: join(root, "data", "mods.json"), contract: "3.3.0", push: () => {} });
    stops.push(() => again.stop());
    await again.start();
    expect(again.list()[0]?.off).toBe("you");
    await again.setOn("linear", true);
    expect(again.list()[0]?.state).toBe("on");
    await expect(again.setOn("nope", true)).rejects.toThrow("there is no mod nope");
  });

  test("a change made while the folder is being read answers with the list after it", async () => {
    const { host, write } = setup();
    write("plain", { "mod.json": JSON.stringify({ name: "plain", version: "1.0.0", shell: "^3.3" }), "index.ts": "export {}" });
    await host.start();
    await host.setOn("plain", false);
    const reading = host.rescan();
    const after = await host.setOn("plain", true);
    await reading;
    expect(after[0]?.state).toBe("on");
  });

  test("in safe mode every mod is off, says why, and serves no code", async () => {
    const { host, write } = setup({ safe: "No mod runs until Channels restarts: a test." });
    write("plain", { "mod.json": JSON.stringify({ name: "plain", version: "1.0.0", shell: "^3.3" }), "index.ts": "export {}" });
    write("broken", { "mod.json": "{ not json" });
    await host.start();
    expect(host.list().map((m) => [m.name, m.state, m.off, m.why])).toEqual([
      ["broken", "off", undefined, "its mod.json isn't JSON"],
      ["plain", "off", "safe", "No mod runs until Channels restarts: a test."],
    ]);
    expect(host.bundle("plain")).toBeNull();
  });

  test("a .safe-mode file in the mods folder starts once with every mod off, and is removed", async () => {
    const { folder, host, write } = setup();
    write("plain", { "mod.json": JSON.stringify({ name: "plain", version: "1.0.0", shell: "^3.3" }), "index.ts": "export {}" });
    writeFileSync(join(folder, ".safe-mode"), "");
    await host.start();
    expect(host.list()[0]).toMatchObject({ state: "off", off: "safe", why: SAFE_FILE });
    expect(host.safe()).toBe(SAFE_FILE);
    expect(existsSync(join(folder, ".safe-mode"))).toBe(false);
  });

  test("two starts in a row whose mods never settle start the next one in safe mode, once", async () => {
    const { root, write } = setup();
    write("plain", { "mod.json": JSON.stringify({ name: "plain", version: "1.0.0", shell: "^3.3" }), "index.ts": "export {}" });
    const run = async (then: (h: ReturnType<typeof modsHost>) => void) => {
      const h = modsHost({ folder: join(root, ".kiwi", "mods"), approvals: join(root, "data", "mods.json"), contract: "3.3.0", push: () => {} });
      await h.start();
      const safe = h.safe();
      then(h);
      h.stop();
      return safe;
    };
    expect(await run((h) => h.bundle("plain"))).toBeNull();
    expect(await run((h) => (h.bundle("plain"), h.settled()))).toBeNull();
    expect(await run((h) => h.bundle("plain"))).toBeNull();
    expect(await run((h) => h.bundle("plain"))).toBeNull();
    expect(await run((h) => expect(h.bundle("plain")).toBeNull())).toBe(SAFE_LOOP);
    expect(await run(() => {})).toBeNull();
    expect(await run(() => {})).toBeNull();
  });
});
