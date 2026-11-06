import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addMod, devRound, git, listMods, ModError, modsDir, nudgeApp, parseSource, readManifest, removeMod, startDev, updateMods } from "../src/mods.ts";
import { bundleMod } from "@kiwi/core/node/mod-bundle.ts";
import { kiwiCmd } from "./owner.ts";

setDefaultTimeout(60_000);

const made: string[] = [];
const scratch = (tag: string): string => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-mods-${tag}-`));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_NOSYSTEM: "1" };
const sh = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function repo(manifest: Record<string, unknown>): string {
  const dir = scratch("src");
  sh(dir, "init", "--quiet", "--initial-branch", "main");
  commit(dir, manifest);
  return dir;
}

function commit(dir: string, manifest: Record<string, unknown>, file = "index.tsx"): string {
  writeFileSync(join(dir, "mod.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, file), `export const at = ${Date.now()}\n`);
  sh(dir, "add", "-A");
  sh(dir, "commit", "--quiet", "-m", "change");
  return sh(dir, "rev-parse", "HEAD");
}

const LINEAR = { name: "linear-panel", version: "1.0.0", shell: "^3.2", needs: ["panel", "command"] };

describe("a mod's source", () => {
  test("github.com/owner/repo clones over https; ssh, https, file and full paths pass as they are; #ref pins a branch, tag or commit", () => {
    expect(parseSource("github.com/ana/linear-panel")).toEqual({ url: "https://github.com/ana/linear-panel.git", shown: "github.com/ana/linear-panel", ref: null });
    expect(parseSource("github.com/ana/linear-panel.git#v1.2.0")).toEqual({ url: "https://github.com/ana/linear-panel.git", shown: "github.com/ana/linear-panel", ref: "v1.2.0" });
    expect(parseSource("https://gitlab.com/ana/x.git").shown).toBe("gitlab.com/ana/x");
    expect(parseSource("git@github.com:ana/x.git#main")).toEqual({ url: "git@github.com:ana/x.git", shown: "git@github.com:ana/x.git", ref: "main" });
    expect(parseSource("/home/ana/code/x").url).toBe("/home/ana/code/x");
  });

  test("an option, a command transport, plain http or a ref that walks is refused before git sees it", () => {
    for (const bad of ["--upload-pack=touch /tmp/x", "-x", "ext::sh -c touch% /tmp/x", "http://example.com/a/b", "a/b", "", "github.com/a/b#--orphan", "github.com/a/b#a..b"]) {
      expect(() => parseSource(bad)).toThrow(ModError);
    }
  });

  test("mod.json is checked the way the app reads it: a name that's a folder and not the app's, a version, a shell range, needs it offers", () => {
    expect(readManifest(JSON.stringify(LINEAR))).toEqual({ name: "linear-panel", version: "1.0.0", shell: "^3.2", needs: ["panel", "command"] });
    const why = (raw: unknown) => {
      try {
        readManifest(typeof raw === "string" ? raw : JSON.stringify(raw));
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(why("{")).toBe("its mod.json isn't JSON");
    expect(why({ ...LINEAR, name: "../evil" })).toBe("mod.json's name must be lowercase letters, digits and dashes");
    expect(why({ ...LINEAR, version: "one" })).toBe("mod.json's version isn't a version like 1.0.0");
    expect(why({ ...LINEAR, needs: "panel" })).toBe("mod.json's needs must be a list of strings");
    expect(why({ ...LINEAR, name: "chat" })).toBe('"chat" is a name Channels keeps for its own commands: pick another');
    expect(why({ ...LINEAR, needs: ["camera"] })).toBe('it asks for "camera", which isn\'t a capability');
    expect(why({ ...LINEAR, shell: "soon" })).toBe("mod.json's shell isn't a version range, like ^3.3");
  });
});

describe("kiwi mod add, list, update and remove", () => {
  test("add clones into mods/<name>, pinned at the commit, and remembers where it came from", () => {
    const home = scratch("home");
    const src = repo(LINEAR);
    const head = sh(src, "rev-parse", "HEAD");
    const added = addMod(home, src);
    expect(added.manifest.name).toBe("linear-panel");
    expect(added.commit).toBe(head);
    const at = join(modsDir(home), "linear-panel");
    expect(sh(at, "rev-parse", "HEAD")).toBe(head);
    expect(sh(at, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");
    expect(() => addMod(home, src)).toThrow(`a mod named linear-panel is already in ${modsDir(home)}`);
    expect(readdirSync(modsDir(home))).toEqual(["linear-panel"]);
  }, 60_000);

  test("a repo that isn't a mod, or a ref it doesn't have, leaves nothing behind", () => {
    const home = scratch("home");
    const plain = scratch("plain");
    sh(plain, "init", "--quiet");
    writeFileSync(join(plain, "README.md"), "hi\n");
    sh(plain, "add", "-A");
    sh(plain, "commit", "--quiet", "-m", "x");
    expect(() => addMod(home, plain)).toThrow(`${plain} isn't a mod: it has no mod.json`);
    expect(() => addMod(home, `${repo(LINEAR)}#v9`)).toThrow('has no branch, tag or commit "v9"');
    expect(() => addMod(home, join(home, "nowhere"))).toThrow("couldn't clone");
    expect(readdirSync(modsDir(home))).toEqual([]);
  });

  test("list shows each mod's version, source, commit and needs; a link, a hand-made folder and a broken one say so", () => {
    const home = scratch("home");
    const src = repo(LINEAR);
    addMod(home, src);
    const dev = scratch("dev");
    writeFileSync(join(dev, "mod.json"), JSON.stringify({ ...LINEAR, name: "my-panel", needs: ["panel"] }));
    symlinkSync(dev, join(modsDir(home), "my-panel"));
    mkdirSync(join(modsDir(home), "broken"));
    writeFileSync(join(modsDir(home), "broken", "mod.json"), "{");
    mkdirSync(join(modsDir(home), ".adding-old"));
    expect(listMods(home)).toEqual([
      { name: "broken", version: null, needs: [], source: null, commit: null, local: true, link: null, changed: false, problem: "its mod.json isn't JSON" },
      {
        name: "linear-panel",
        version: "1.0.0",
        needs: ["panel", "command"],
        source: src,
        commit: sh(src, "rev-parse", "HEAD").slice(0, 7),
        local: false,
        link: null,
        changed: false,
        problem: null,
      },
      { name: "my-panel", version: "1.0.0", needs: ["panel"], source: null, commit: null, local: true, link: dev, changed: false, problem: null },
    ]);
  });

  test("update takes new commits, holds one that asks for more until --yes, and says what it asks for now", () => {
    const home = scratch("home");
    const src = repo(LINEAR);
    addMod(home, src);
    expect(updateMods(home, null, false)).toEqual({ changes: [], current: ["linear-panel"], skipped: [] });

    commit(src, { ...LINEAR, version: "1.1.0" });
    const fix = sh(src, "rev-parse", "HEAD");
    expect(updateMods(home, "linear-panel", false).changes).toEqual([{ name: "linear-panel", from: "1.0.0", to: "1.1.0", commits: 1, added: [], dropped: [], applied: true }]);
    expect(sh(join(modsDir(home), "linear-panel"), "rev-parse", "HEAD")).toBe(fix);

    commit(src, { ...LINEAR, version: "2.0.0", needs: ["panel", "net:api.linear.app"] });
    const more = sh(src, "rev-parse", "HEAD");
    const held = updateMods(home, null, false).changes[0];
    expect(held).toEqual({ name: "linear-panel", from: "1.1.0", to: "2.0.0", commits: 1, added: ["net:api.linear.app"], dropped: ["command"], applied: false });
    expect(sh(join(modsDir(home), "linear-panel"), "rev-parse", "HEAD")).toBe(fix);
    expect(updateMods(home, null, true).changes[0]?.applied).toBe(true);
    expect(sh(join(modsDir(home), "linear-panel"), "rev-parse", "HEAD")).toBe(more);
  });

  test("a mod pinned to a tag stays on it; local changes and hand-made folders aren't pulled over", () => {
    const home = scratch("home");
    const src = repo(LINEAR);
    sh(src, "tag", "v1");
    const tagged = sh(src, "rev-parse", "HEAD");
    addMod(home, `${src}#v1`);
    commit(src, { ...LINEAR, version: "1.5.0" });
    expect(updateMods(home, null, false).current).toEqual(["linear-panel"]);
    expect(sh(join(modsDir(home), "linear-panel"), "rev-parse", "HEAD")).toBe(tagged);

    writeFileSync(join(modsDir(home), "linear-panel", "index.tsx"), "export const mine = 1\n");
    mkdirSync(join(modsDir(home), "mine"));
    expect(updateMods(home, null, true).skipped).toEqual([
      { name: "linear-panel", why: "has changes that aren't in its source: commit and push them, or kiwi mod remove it and add it again" },
      { name: "mine", why: "isn't from a git source, so there's nothing to pull" },
    ]);
    expect(() => updateMods(home, "nope", false)).toThrow("there's no mod named nope");
    expect(() => updateMods(home, "../x", false)).toThrow('"../x" isn\'t a mod name');
  });

  test("remove deletes a clone, refuses to lose work without --force, and takes only the link of a linked mod", () => {
    const home = scratch("home");
    addMod(home, repo(LINEAR));
    removeMod(home, "linear-panel", false);
    expect(existsSync(join(modsDir(home), "linear-panel"))).toBe(false);

    addMod(home, repo(LINEAR));
    writeFileSync(join(modsDir(home), "linear-panel", "notes.md"), "mine\n");
    expect(() => removeMod(home, "linear-panel", false)).toThrow("linear-panel has changes that aren't in its source: --force removes them anyway");
    removeMod(home, "linear-panel", true);

    mkdirSync(join(modsDir(home), "mine"));
    expect(() => removeMod(home, "mine", false)).toThrow("mine isn't from a git source, so removing it deletes its only copy: --force removes it anyway");

    const dev = scratch("dev");
    symlinkSync(dev, join(modsDir(home), "my-panel"));
    expect(removeMod(home, "my-panel", false)).toEqual({ link: dev });
    expect(existsSync(dev)).toBe(true);
    expect(() => removeMod(home, "../../etc", true)).toThrow('"../../etc" isn\'t a mod name');
    expect(() => removeMod(home, "gone", false)).toThrow("there's no mod named gone");
  });

  test("git never waits on a password prompt and refuses transports that run commands", () => {
    expect(() => git(["ls-remote", "--", "ext::sh -c true"])).toThrow(ModError);
  });
});

describe("kiwi mod dev", () => {
  test("makes a starter mod that the app's own checks and bundler take, then opens it again", async () => {
    const home = scratch("dev");
    const made = startDev(home, "standup-notes", scratch("cwd"));
    expect(made).toEqual({ at: join(modsDir(home), "standup-notes"), dir: join(modsDir(home), "standup-notes"), how: "created" });
    expect(JSON.parse(readFileSync(join(made.dir, "mod.json"), "utf8"))).toEqual({ name: "standup-notes", version: "0.1.0", shell: "^3.6", needs: ["panel"] });
    expect(readFileSync(join(made.dir, "index.tsx"), "utf8")).toContain('panel({ title: "Standup Notes", render: View })');
    const round = await devRound(made.dir, "standup-notes");
    expect(round.ok && round.manifest.needs).toEqual(["panel"]);
    expect(startDev(home, "standup-notes", scratch("cwd")).how).toBe("opened");
  });

  test("the starter uses only what the frame's @kiwi/mod offers, and opens a panel that renders its title", async () => {
    const { dir } = startDev(scratch("dev"), "standup-notes", scratch("cwd"));
    const built = await bundleMod(dir);
    if (!built.ok) throw new Error(built.why);
    const runtime = readFileSync(join(import.meta.dir, "../ui/src/mods/frame/runtime.tsx"), "utf8");
    const api = runtime.slice(runtime.indexOf("const api = {"), runtime.indexOf("\n}\n", runtime.indexOf("const api = {")));
    const used = [...readFileSync(join(dir, "index.tsx"), "utf8").matchAll(/import \{ ([^}]+) \} from "@kiwi\/mod"/g)].flatMap((m) => m[1]!.split(",").map((n) => n.trim()));
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) expect(api).toMatch(new RegExp(`\\n  ${name}\\b`));
    const panels: { title: string; render: () => unknown }[] = [];
    const el = (type: unknown, props: Record<string, unknown>) => ({ type, props });
    const g = globalThis as Record<string, unknown>;
    g["__kiwiMod"] = {
      react: { useState: (v: unknown) => [v, () => undefined] },
      "react/jsx-runtime": { jsx: el, jsxs: el, Fragment: "fragment" },
      "react/jsx-dev-runtime": { jsxDEV: el, Fragment: "fragment" },
      "@kiwi/mod": { panel: (p: { title: string; render: () => unknown }) => panels.push(p), Button: "Button", Row: "Row" },
    };
    try {
      new Function(built.code)();
    } finally {
      delete g["__kiwiMod"];
    }
    expect(panels.map((p) => p.title)).toEqual(["Standup Notes"]);
    expect(JSON.stringify(panels[0]!.render())).toContain('"title":"Standup Notes"');
  });

  test("links the folder it runs in when its mod.json has that name, and says when the name is another", () => {
    const home = scratch("dev");
    const work = scratch("work");
    writeFileSync(join(work, "mod.json"), JSON.stringify({ ...LINEAR }));
    expect(() => startDev(home, "other-panel", work)).toThrow('this folder\'s mod.json names it "linear-panel": kiwi mod dev linear-panel');
    const linked = startDev(home, "linear-panel", work);
    expect(linked.how).toBe("linked");
    expect(lstatSync(linked.at).isSymbolicLink()).toBe(true);
    expect(startDev(home, "linear-panel", scratch("cwd"))).toMatchObject({ how: "opened", dir: linked.dir });
    rmSync(work, { recursive: true });
    expect(() => startDev(home, "linear-panel", scratch("cwd"))).toThrow("which is gone: kiwi mod remove linear-panel, then link it again");
  });

  test("refuses a name the app keeps or one that isn't a name, and creates nothing", () => {
    const home = scratch("dev");
    expect(() => startDev(home, "chat", scratch("cwd"))).toThrow('"chat" is a name Channels keeps for its own commands: pick another');
    expect(() => startDev(home, "../x", scratch("cwd"))).toThrow('"../x" isn\'t a mod name');
    expect(existsSync(modsDir(home))).toBe(false);
  });

  test("a round says why a broken mod.json or code can't load", async () => {
    const home = scratch("dev");
    const { dir } = startDev(home, "my-panel", scratch("cwd"));
    writeFileSync(join(dir, "index.tsx"), "export const = 1\n");
    const broken = await devRound(dir, "my-panel");
    expect(broken.ok).toBe(false);
    writeFileSync(join(dir, "mod.json"), JSON.stringify({ name: "my-panel", version: "0.1.0", shell: "^3.6", needs: ["camera"] }));
    expect(await devRound(dir, "my-panel")).toEqual({ ok: false, why: 'it asks for "camera", which isn\'t a capability' });
  });

  test("touches a linked mod's link so the app's watcher sees an edit it can't see through the link", async () => {
    const home = scratch("dev");
    const work = scratch("work");
    writeFileSync(join(work, "mod.json"), JSON.stringify({ ...LINEAR }));
    const { at } = startDev(home, "linear-panel", work);
    const before = lstatSync(at).mtimeMs;
    await Bun.sleep(20);
    nudgeApp(at);
    expect(lstatSync(at).mtimeMs).toBeGreaterThan(before);
    const { at: plain } = startDev(home, "plain-panel", scratch("cwd"));
    const inside = lstatSync(plain).mtimeMs;
    nudgeApp(plain);
    expect(lstatSync(plain).mtimeMs).toBe(inside);
  });
});

describe("the kiwi mod command", () => {
  async function kiwi(home: string, ...args: string[]) {
    const p = Bun.spawn(kiwiCmd(["mod", ...args]), { cwd: home, env: { ...ENV, KIWI_HOME: home, KIWI_NO_HOOKS: "1" }, stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, out, err };
  }

  test("dev makes a mod, rebuilds it on each save, and says when it asks for more", async () => {
    const home = scratch("cli");
    const p = Bun.spawn(kiwiCmd(["mod", "dev", "standup-notes"]), { cwd: scratch("cwd"), env: { ...ENV, KIWI_HOME: home, KIWI_NO_HOOKS: "1" }, stdout: "pipe", stderr: "pipe" });
    let seen = "";
    const reader = p.stdout.getReader();
    const until = async (text: string) => {
      const end = Date.now() + 30_000;
      while (!seen.includes(text)) {
        if (Date.now() > end) throw new Error(`no "${text}" in:\n${seen}`);
        const { value, done } = await Promise.race([reader.read(), Bun.sleep(500).then(() => ({ value: undefined, done: false }))]);
        if (done) throw new Error(`kiwi mod dev exited:\n${seen}`);
        if (value) seen += new TextDecoder().decode(value);
      }
    };
    try {
      const dir = join(home, "mods", "standup-notes");
      await until("built standup-notes 0.1.0");
      expect(seen).toContain(`created ${dir} with mod.json and index.tsx`);
      expect(seen).toContain("it asks for panel; Channels shows any it doesn't have for you to approve");
      writeFileSync(join(dir, "index.tsx"), readFileSync(join(dir, "index.tsx"), "utf8").replace("Pressed", "Clicked"));
      await until("rebuilt standup-notes 0.1.0");
      writeFileSync(join(dir, "mod.json"), JSON.stringify({ name: "standup-notes", version: "0.2.0", shell: "^3.6", needs: ["panel", "command"] }));
      await until("it now asks for panel, command");
      writeFileSync(join(dir, "mod.json"), "{");
      await until("can't load: its mod.json isn't JSON");
    } finally {
      p.kill();
      await p.exited;
    }
  });

  test("add, list, update, remove and a wrong word, end to end", async () => {
    const home = scratch("cli");
    expect((await kiwi(home)).out).toBe(`no mods in ${join(home, "mods")} (kiwi mod add github.com/owner/repo)\n`);
    const src = repo(LINEAR);
    const added = await kiwi(home, "add", src);
    expect(added.code).toBe(0);
    expect(added.out).toBe(
      `added linear-panel 1.0.0 from ${src} @ ${sh(src, "rev-parse", "HEAD").slice(0, 7)}\nit asks for panel, command; Channels shows these for you to approve before it runs the mod\n`,
    );
    expect(JSON.parse((await kiwi(home, "list", "--json")).out)[0].name).toBe("linear-panel");
    commit(src, { ...LINEAR, version: "2.0.0", needs: ["panel", "command", "net:api.linear.app"] });
    const held = await kiwi(home, "update");
    expect(held.code).toBe(1);
    expect(held.out).toBe("linear-panel 1.0.0 → 2.0.0 (1 new commit): not taken\n  now also asks for net:api.linear.app\n");
    expect(held.err).toContain("not taken: linear-panel asks for more; kiwi mod update linear-panel --yes takes it");
    expect((await kiwi(home, "update", "--yes")).out).toContain("Channels asks you to approve the new ones before it runs the mod again");
    expect((await kiwi(home, "remove", "linear-panel")).out).toBe("removed linear-panel\n");
    const wrong = await kiwi(home, "install", "x");
    expect(wrong.code).toBe(2);
    expect(wrong.err).toContain("usage: kiwi mod add <repo>[#ref]");
  });
});
