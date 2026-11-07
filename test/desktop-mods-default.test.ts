import { afterEach, describe, expect, test } from "bun:test";
import { copiesIn, folderHash } from "@kiwi/core/node/mod-folder.ts";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_MODS, installDefaults } from "../desktop/src/mods-default.ts";
import type { Pinned } from "../desktop/src/mods-pinned.ts";
import { modsHost } from "../desktop/src/mods-host.ts";

const roots: string[] = [];

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const COMMIT = "a".repeat(40);

const github = {
  "mod.json": JSON.stringify({ name: "github", version: "1.0.0", shell: "^3.7", needs: ["tab", "panel", "github"] }),
  "index.tsx": `import { tab } from "@kiwi/mod"\ntab({ title: "GitHub", render: () => null })\n`,
  "parts/view.css": ".gh-row { display: grid }\n",
};

function setup(files: Record<string, string> = github) {
  const root = mkdtempSync(join(tmpdir(), "kiwi-mods-default-"));
  roots.push(root);
  const source = join(root, "source");
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(source, file, ".."), { recursive: true });
    writeFileSync(join(source, file), text);
  }
  const pin: Pinned = { name: "github", repo: "kiwi-init/mods", path: "github", commit: COMMIT, hash: folderHash(source), files: Object.keys(files) };
  const asked: string[] = [];
  let fail: ((url: string) => Response | null) | null = null;
  const request = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    const failed = fail?.(url);
    if (failed) return failed;
    const prefix = `https://raw.githubusercontent.com/kiwi-init/mods/${COMMIT}/github/`;
    if (url.startsWith(prefix)) return new Response(readFileSync(join(source, decodeURIComponent(url.slice(prefix.length)))));
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  const opts = {
    folder: join(root, ".kiwi", "mods"),
    approvals: join(root, "data", "mods.json"),
    record: join(root, "data", "mods-defaults.json"),
    contract: "3.7.0",
    pins: [pin],
    request,
  };
  return { root, pin, asked, opts, failWith: (f: (url: string) => Response | null) => (fail = f) };
}

describe("the mods that come with the app (T6270)", () => {
  test("the app pins the GitHub and Calm mods from kiwi-init/mods, each at one commit, its files and one folder hash", () => {
    expect(DEFAULT_MODS.map((p) => [p.name, p.repo, p.path])).toEqual([
      ["github", "kiwi-init/mods", "github"],
      ["calm", "kiwi-init/mods", "calm"],
    ]);
    for (const p of DEFAULT_MODS) {
      expect(p.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(p.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(p.files).toContain("mod.json");
    }
  });

  test("with an empty ~/.kiwi/ it lands in the mods folder over HTTPS, approved, with its source kept as kiwi mod add keeps it", async () => {
    const { opts, pin, asked } = setup();
    expect(await installDefaults(opts)).toEqual([]);
    const at = join(opts.folder, "github");
    expect(folderHash(at)).toBe(pin.hash);
    expect(JSON.parse(readFileSync(opts.approvals, "utf8"))).toEqual({
      approved: { github: { needs: ["github", "panel", "tab"], source: "github.com/kiwi-init/mods/github" } },
      off: {},
      values: {},
      unsettledStarts: 0,
    });
    expect(copiesIn(opts.folder)).toEqual({
      github: { source: "github.com/kiwi-init/mods/github", url: "https://github.com/kiwi-init/mods.git", path: "github", ref: null, commit: COMMIT, hash: pin.hash },
    });
    expect(readdirSync(opts.folder).sort()).toEqual([".sources.json", "github"]);
    expect(asked.every((u) => u.startsWith(`https://raw.githubusercontent.com/kiwi-init/mods/${COMMIT}/github/`))).toBe(true);
  });

  test("it runs on the next scan without asking", async () => {
    const { opts } = setup();
    await installDefaults(opts);
    const host = modsHost({ folder: opts.folder, approvals: opts.approvals, contract: "3.7.0", push: () => {} });
    await host.rescan();
    expect(host.list()).toEqual([expect.objectContaining({ name: "github", state: "on", needs: ["tab", "panel", "github"] })]);
  });

  test("it installs once: a person who removes it, or keeps a github mod of their own, keeps that", async () => {
    const { opts, asked } = setup();
    await installDefaults(opts);
    rmSync(join(opts.folder, "github"), { recursive: true });
    const before = asked.length;
    expect(await installDefaults(opts)).toEqual([]);
    expect(existsSync(join(opts.folder, "github"))).toBe(false);
    expect(asked.length).toBe(before);

    const theirs = setup();
    mkdirSync(join(theirs.opts.folder, "github"), { recursive: true });
    writeFileSync(join(theirs.opts.folder, "github", "mod.json"), "{}");
    expect(await installDefaults(theirs.opts)).toEqual([]);
    expect(theirs.asked).toEqual([]);
    expect(readFileSync(join(theirs.opts.folder, "github", "mod.json"), "utf8")).toBe("{}");
    expect(JSON.parse(readFileSync(theirs.opts.record, "utf8"))).toEqual({ installed: { github: "theirs" } });
  });

  test("a failed install leaves nothing behind, says why, and tries again on the next start", async () => {
    const { opts, failWith } = setup();
    failWith((url) => (url.endsWith("/mod.json") ? new Response("", { status: 404 }) : null));
    const [off] = await installDefaults(opts);
    expect(off).toEqual({
      name: "github",
      version: null,
      source: "github.com/kiwi-init/mods/github",
      needs: [],
      approved: [],
      state: "off",
      why: expect.stringContaining("raw.githubusercontent.com answered 404 (is the repo public?)"),
    });
    expect(off?.why).toContain("tries again when it starts");
    expect(existsSync(opts.record)).toBe(false);
    expect(readdirSync(opts.folder)).toEqual([]);
    failWith(() => null);
    expect(await installDefaults(opts)).toEqual([]);
    expect(existsSync(join(opts.folder, "github", "mod.json"))).toBe(true);
  });

  test("a download that isn't the pinned copy is refused", async () => {
    const { opts, failWith } = setup();
    failWith((url) => (url.endsWith("/index.tsx") ? new Response("evil()") : null));
    const [off] = await installDefaults(opts);
    expect(off?.why).toContain("the download isn't the copy this app was built with");
    expect(readdirSync(opts.folder)).toEqual([]);
    expect(existsSync(opts.approvals)).toBe(false);
  });

  test("a pin that leaves a file out, or names one outside its folder, is refused", async () => {
    const short = setup();
    const [missing] = await installDefaults({ ...short.opts, pins: [{ ...short.pin, files: short.pin.files.filter((f) => f !== "parts/view.css") }] });
    expect(missing?.why).toContain("the download isn't the copy this app was built with");
    expect(readdirSync(short.opts.folder)).toEqual([]);
    const out = setup();
    const [outside] = await installDefaults({ ...out.opts, pins: [{ ...out.pin, files: [...out.pin.files, "../anatomy/mod.json"] }] });
    expect(outside?.why).toContain("isn't a plain path");
    expect(out.asked.some((u) => u.includes("anatomy"))).toBe(false);
  });

  test("a mod the app's contract can't run is refused, unapproved", async () => {
    const { opts } = setup({ ...github, "mod.json": JSON.stringify({ name: "github", version: "1.0.0", shell: "^9.0", needs: ["tab"] }) });
    const [off] = await installDefaults(opts);
    expect(off?.state).toBe("off");
    expect(existsSync(join(opts.folder, "github"))).toBe(false);
    expect(existsSync(opts.approvals)).toBe(false);
  });
});
