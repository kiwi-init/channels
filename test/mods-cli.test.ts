import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addMod, git, listMods, ModError, modsDir, parseSource, readManifest, removeMod, updateMods } from "../src/mods.ts";
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

  test("mod.json is checked the way the app reads it: a name that's a folder, a version, a list of needs", () => {
    expect(readManifest(JSON.stringify(LINEAR))).toEqual({ name: "linear-panel", version: "1.0.0", needs: ["panel", "command"] });
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

describe("the kiwi mod command", () => {
  async function kiwi(home: string, ...args: string[]) {
    const p = Bun.spawn(kiwiCmd(["mod", ...args]), { cwd: home, env: { ...ENV, KIWI_HOME: home, KIWI_NO_HOOKS: "1" }, stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, out, err };
  }

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
