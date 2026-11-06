import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModView } from "../desktop/src/bridge.ts";
import { modsHost, type ModsHostOptions } from "../desktop/src/mods-host.ts";

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
    expect(host.list()).toEqual([{ name: "linear", version: "1.0.0", needs: ["panel", "net:api.linear.app"], approved: [], state: "asks" }]);
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
});
