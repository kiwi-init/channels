import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModSettingView, ModView } from "../desktop/src/bridge.ts";
import { memorySecrets, modSource, modsHost, type ModsHostOptions } from "../desktop/src/mods-host.ts";
import { checkManifest } from "@kiwi/core/node/mod-manifest.ts";
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

  test("a mod's icon reaches the page as bytes with a type the app sets, named by a hash in its view, even before it's approved", async () => {
    const { host, write } = setup();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" onload="top.ran=1"><script>top.ran=2</script><rect width="8" height="8"/></svg>`;
    write("linear", { ...linear, "mod.json": JSON.stringify({ ...JSON.parse(linear["mod.json"]), icon: "art/icon.svg" }), "art/icon.svg": svg });
    await host.start();
    const [view] = host.list();
    expect(view).toMatchObject({ state: "asks", icon: expect.stringMatching(/^[0-9a-f]{16}$/) });
    const icon = host.icon("linear");
    expect(icon?.type).toBe("image/svg+xml");
    expect(Buffer.from(icon?.data ?? "", "base64").toString("utf8")).toBe(svg);
    write("linear", { "art/icon.svg": svg.replace("8 8", "9 9") });
    await host.rescan();
    expect(host.list()[0]?.icon).not.toBe(view?.icon);
    expect(host.icon("nope")).toBeNull();
  });

  test("an icon that's missing, isn't the image it names or links out of the mod's folder is left out, and its details say why", async () => {
    const { root, host, write } = setup();
    writeFileSync(join(root, "secret.svg"), "<svg/>");
    const named = (icon: string) => JSON.stringify({ ...JSON.parse(linear["mod.json"]), icon });
    write("gone", { "mod.json": named("icon.svg").replace("linear", "gone"), "index.tsx": "" });
    write("fake", { "mod.json": named("icon.png").replace("linear", "fake"), "index.tsx": "", "icon.png": "<svg/>" });
    write("out", { "mod.json": named("icon.svg").replace("linear", "out"), "index.tsx": "" });
    symlinkSync(join(root, "secret.svg"), join(root, ".kiwi", "mods", "out", "icon.svg"));
    await host.start();
    expect(host.list().map((m) => [m.name, m.icon])).toEqual([
      ["fake", undefined],
      ["gone", undefined],
      ["out", undefined],
    ]);
    expect(host.icon("out")).toBeNull();
    expect(host.details("gone")?.iconWhy).toBe("its icon icon.svg isn't in its folder");
    expect(host.details("fake")?.iconWhy).toBe("its icon icon.png isn't a PNG");
    expect(host.details("out")?.iconWhy).toBe("its icon icon.svg links out of its folder");
  });

  test("a mod's details: its author, where it came from at which commit, when it was added and changed, its size and its README", async () => {
    const { folder, host, write } = setup();
    const commit = "0123456789abcdef0123456789abcdef01234567";
    write("linear", {
      ...linear,
      "mod.json": JSON.stringify({ ...JSON.parse(linear["mod.json"]), author: "Ana Lima" }),
      "README.md": "# Linear\n\nYour issues beside the chat.\n",
      ".git/config": "[kiwi]\n\tsource = github.com/ana/linear\n\tadded = 2026-11-01T10:00:00.000Z\n",
      ".git/HEAD": `${commit}\n`,
    });
    write("notes", {
      "mod.json": JSON.stringify({ name: "notes", version: "0.1.0", shell: "^3.3" }),
      "index.tsx": "",
      readme: "plain words",
      ".git/HEAD": "ref: refs/heads/main\n",
      ".git/packed-refs": `# pack-refs\n${commit} refs/heads/main\n`,
    });
    await host.start();
    const d = host.details("linear");
    expect(d).toMatchObject({ name: "linear", version: "1.0.0", author: "Ana Lima", source: "github.com/ana/linear", commit, installed: Date.parse("2026-11-01T10:00:00.000Z"), iconWhy: null });
    expect(d?.readme).toBe("# Linear\n\nYour issues beside the chat.\n");
    const files = ["mod.json", "index.tsx", "README.md", ".git/config", ".git/HEAD"].map((f) => statSync(join(folder, "linear", f)));
    expect(d?.bytes).toBe(files.reduce((n, f) => n + f.size, 0));
    expect(d?.updated).toBe(Math.round(Math.max(...files.slice(0, 3).map((f) => f.mtimeMs))));
    expect(host.details("notes")).toMatchObject({ author: null, source: "local", commit, readme: "plain words" });
    expect(host.details("nope")).toBeNull();
  });

  test("a required setting left empty keeps a mod off and names it; once filled, the mod runs and gets its values at boot", async () => {
    const { host, write } = setup();
    const token: ModSettingView = { id: "token", title: "API token", type: "secret", required: true };
    const team: ModSettingView = { id: "team", title: "Team", type: "text" };
    const depth: ModSettingView = { id: "depth", title: "Depth", type: "choice", choices: ["Mine", "All"], required: true };
    const quiet: ModSettingView = { id: "quiet", title: "Quiet", type: "toggle" };
    const settings = [token, team, depth, quiet];
    write("linear", { ...linear, "mod.json": JSON.stringify({ ...JSON.parse(linear["mod.json"]), settings }) });
    await host.start();
    await host.approve("linear", ["panel", "net:api.linear.app"]);
    expect(host.list()[0]).toMatchObject({ state: "off", off: "settings", settingsRev: 0, why: "It needs its API token setting: fill it in on its page in Settings → Mods." });
    expect(host.bundle("linear")).toBeNull();
    await host.setSetting("linear", "token", "lin_api_7f3a");
    expect(host.list()[0]).toMatchObject({ state: "off", why: "It needs its Depth setting: fill it in on its page in Settings → Mods." });
    await expect(host.setSetting("linear", "depth", "Some")).rejects.toThrow('Depth has no choice "Some"');
    await expect(host.setSetting("linear", "quiet", "yes")).rejects.toThrow("Quiet takes on or off");
    await expect(host.setSetting("linear", "team", "x".repeat(2_001))).rejects.toThrow("Team is too long");
    await expect(host.setSetting("linear", "nope", "x")).rejects.toThrow("linear has no setting nope");
    await host.setSetting("linear", "depth", "Mine");
    expect(host.list()[0]).toMatchObject({ state: "on", settingsRev: 2 });
    expect(host.bundle("linear")?.settings).toEqual({ token: "lin_api_7f3a", team: null, depth: "Mine", quiet: false });
    await host.setSetting("linear", "quiet", true);
    await host.setSetting("linear", "team", "Platform");
    expect(host.bundle("linear")?.settings).toEqual({ token: "lin_api_7f3a", team: "Platform", depth: "Mine", quiet: true });
    expect(host.details("linear")?.settings).toEqual([
      { ...token, set: true },
      { ...team, value: "Platform" },
      { ...depth, value: "Mine" },
      { ...quiet, value: true },
    ]);
    await host.setSetting("linear", "token", null);
    expect(host.list()[0]).toMatchObject({ state: "off", off: "settings" });
  });

  test("a secret reaches only its own mod, is written to no file, outlasts a restart, and isn't handed to another mod that takes the same name", async () => {
    const { root, folder, host, write } = setup();
    const secrets = memorySecrets();
    const named = (name: string) => ({
      ...linear,
      "mod.json": JSON.stringify({ ...JSON.parse(linear["mod.json"]), name, needs: [], settings: [{ id: "token", title: "Token", type: "secret", required: true }] }),
    });
    host.stop();
    const first = modsHost({ folder, approvals: join(root, "data", "mods.json"), contract: "3.3.0", push: () => {}, secrets });
    stops.push(() => first.stop());
    write("alpha", named("alpha"));
    write("beta", named("beta"));
    await first.start();
    const SECRET = "sk-only-alpha-91c2";
    await first.setSetting("alpha", "token", SECRET);
    await first.setSetting("beta", "token", "sk-beta");
    expect(first.bundle("alpha")?.settings).toEqual({ token: SECRET });
    expect(first.bundle("beta")?.settings).toEqual({ token: "sk-beta" });
    const everyFile = (dir: string): string[] =>
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => join(d.parentPath, d.name));
    expect(everyFile(root).filter((f) => readFileSync(f, "utf8").includes(SECRET))).toEqual([]);
    first.stop();
    const again = modsHost({ folder, approvals: join(root, "data", "mods.json"), contract: "3.3.0", push: () => {}, secrets });
    stops.push(() => again.stop());
    await again.start();
    expect(again.bundle("alpha")?.settings).toEqual({ token: SECRET });
    write("alpha", { ".git/config": "[kiwi]\n\tsource = github.com/someone/alpha\n" });
    await again.rescan();
    expect(again.list().find((m) => m.name === "alpha")).toMatchObject({ source: "github.com/someone/alpha", state: "off", off: "settings" });
    expect(again.details("alpha")?.settings[0]?.set).toBe(false);
  });

  test("mod.json's settings are checked: ids, titles, types and choices", () => {
    const check = (settings: unknown) => {
      const r = checkManifest({ name: "linear", version: "1.0.0", shell: "^3.3", settings }, "linear", null);
      return r.ok ? r.manifest.settings : r.why;
    };
    expect(check([{ id: "token", title: " Token ", type: "secret", required: true }])).toEqual([{ id: "token", title: "Token", type: "secret", required: true }]);
    expect(check([])).toBeUndefined();
    expect(check("token")).toBe("mod.json's settings must be a list of up to 20");
    expect(check(Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, title: "S", type: "text" })))).toBe("mod.json's settings must be a list of up to 20");
    expect(check([{ id: "Token", title: "T", type: "text" }])).toBe("setting 1 in mod.json needs an id of lowercase letters, digits and dashes");
    expect(
      check([
        { id: "a", title: "A", type: "text" },
        { id: "a", title: "B", type: "text" },
      ]),
    ).toBe('mod.json lists the setting "a" twice');
    expect(check([{ id: "a", title: "", type: "text" }])).toBe('the setting "a" needs a title of up to 80 characters');
    expect(check([{ id: "a", title: "A", type: "password" }])).toBe('the setting "a" has to be text, toggle, choice or secret');
    expect(check([{ id: "a", title: "A", type: "toggle", required: true }])).toBe('the setting "a" is a toggle, which can\'t be required');
    expect(check([{ id: "a", title: "A", type: "choice", choices: [] }])).toBe('the setting "a" needs choices: a list of up to 30 different names');
    expect(check([{ id: "a", title: "A", type: "choice", choices: ["x", "x"] }])).toBe('the setting "a" needs choices: a list of up to 30 different names');
    expect(check([{ id: "a", title: "A", type: "text", choices: ["x"] }])).toBe('the setting "a" has choices, which only a choice takes');
    expect(check([{ id: "a", title: "A", type: "text", required: "yes" }])).toBe('the setting "a" has a required that isn\'t true or false');
  });

  test("a mod kiwi mod add copied out of a repo of many takes its source from .sources.json, and a kiwi mod dev link is local", () => {
    const mods = mkdtempSync(join(tmpdir(), "kiwi-mod-copies-"));
    roots.push(mods);
    mkdirSync(join(mods, "lint"));
    expect(modSource(join(mods, "lint"))).toBe("local");
    writeFileSync(join(mods, ".sources.json"), JSON.stringify({ lint: { source: "github.com/a/many/lint", commit: "abc" } }));
    expect(modSource(join(mods, "lint"))).toBe("github.com/a/many/lint");
    writeFileSync(join(mods, ".sources.json"), JSON.stringify({ lint: { source: "github.com/b/many/lint" } }));
    expect(modSource(join(mods, "lint"))).toBe("github.com/b/many/lint");
    writeFileSync(join(mods, ".sources.json"), "not json");
    expect(modSource(join(mods, "lint"))).toBe("local");
    const real = mkdtempSync(join(tmpdir(), "kiwi-mod-dev-"));
    roots.push(real);
    mkdirSync(join(real, ".git"));
    writeFileSync(join(real, ".git", "config"), "[kiwi]\n\tsource = someone/else\n");
    symlinkSync(real, join(mods, "dev"));
    expect(modSource(join(mods, "dev"))).toBe("local");
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
