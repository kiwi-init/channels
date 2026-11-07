import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readCatalog } from "@kiwi/core/node/mod-catalog.ts";
import { folderHash } from "@kiwi/core/node/mod-folder.ts";

import { modsCatalog } from "../desktop/src/mods-catalog.ts";

const roots: string[] = [];

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const COMMIT = "b".repeat(40);
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><script>top.ran = 1</script><rect width="16" height="16"/></svg>`;

const notes = {
  "mod.json": JSON.stringify({ name: "notes", version: "1.0.0", shell: "^3.3", needs: ["panel", "net:api.example.com"], icon: "icon.svg" }),
  "index.tsx": `import { panel } from "@kiwi/mod"\npanel({ title: "Notes", render: () => null })\n`,
  "icon.svg": ICON,
};

function setup(files: Record<string, string> = notes, entry: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "kiwi-mods-catalog-"));
  roots.push(root);
  const source = join(root, "source");
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(source, file, ".."), { recursive: true });
    writeFileSync(join(source, file), text);
  }
  const index = {
    mods: [
      {
        name: "notes",
        does: "keeps notes beside the chat",
        needs: ["panel", "net:api.example.com"],
        commit: COMMIT,
        hash: folderHash(source),
        files: Object.keys(files),
        icon: "icon.svg",
        author: "Kiwi",
        ...entry,
      },
      { name: "unpinned", does: "isn't pinned yet", add: "kiwi mod add github.com/kiwi-init/mods/unpinned", needs: [] },
    ],
  };
  const asked: string[] = [];
  let tamper: ((url: string, body: Uint8Array) => Uint8Array) | null = null;
  let down = false;
  const request = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    if (down) throw new Error("offline");
    if (url === "https://raw.githubusercontent.com/kiwi-init/mods/main/mods.json") return new Response(JSON.stringify(index));
    const prefix = `https://raw.githubusercontent.com/kiwi-init/mods/${COMMIT}/notes/`;
    if (url.startsWith(prefix)) {
      const body = new Uint8Array(readFileSync(join(source, decodeURIComponent(url.slice(prefix.length)))));
      return new Response(tamper ? tamper(url, body) : body);
    }
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  const opts = { folder: join(root, ".kiwi", "mods"), approvals: join(root, "data", "mods.json"), contract: "3.13.0", request };
  return { root, opts, asked, catalog: modsCatalog(opts), tamperWith: (f: typeof tamper) => (tamper = f), goOffline: () => (down = true) };
}

describe("the vouched catalog from kiwi-init/mods (T7363)", () => {
  test("its index lists pinned mods, and skips the ones that aren't pinned, saying why", () => {
    const c = readCatalog({
      mods: [
        { name: "ok", does: "works", needs: ["panel"], commit: "c".repeat(40), hash: "d".repeat(64), files: ["mod.json", "index.tsx"] },
        { name: "ok", does: "again", needs: [], commit: "c".repeat(40), hash: "d".repeat(64), files: ["mod.json"] },
        { name: "loose", does: "no pin", needs: [] },
        { name: "escape", does: "x", needs: [], commit: "c".repeat(40), hash: "d".repeat(64), files: ["mod.json", "../etc/passwd"] },
        { name: "nomanifest", does: "x", needs: [], commit: "c".repeat(40), hash: "d".repeat(64), files: ["index.tsx"] },
        { name: "badicon", does: "x", needs: [], commit: "c".repeat(40), hash: "d".repeat(64), files: ["mod.json"], icon: "icon.svg" },
        { name: "Bad Name", does: "x", needs: [] },
      ],
    });
    expect(c.entries.map((e) => e.name)).toEqual(["ok"]);
    expect(c.skipped).toEqual([
      { name: "ok", why: "the catalog lists it twice" },
      { name: "loose", why: "it isn't pinned to a commit and a folder hash yet" },
      { name: "escape", why: "its files aren't a list of up to 200 paths in its folder" },
      { name: "nomanifest", why: "its files don't include mod.json" },
      { name: "badicon", why: "its icon isn't one of its .svg or .png files" },
      { name: "Bad Name", why: "its name isn't a mod name" },
    ]);
    expect(readCatalog("nope")).toEqual({ entries: [], skipped: [] });
  });

  test("the list shows each pinned mod with what it asks for, its icon checked, and whether it's installed", async () => {
    const { catalog } = setup();
    const list = await catalog.list();
    expect(list.why).toBeNull();
    expect(list.mods).toEqual([
      {
        name: "notes",
        does: "keeps notes beside the chat",
        needs: ["panel", "net:api.example.com"],
        commit: COMMIT,
        source: "github.com/kiwi-init/mods/notes",
        installed: false,
        author: "Kiwi",
        icon: { type: "image/svg+xml", data: Buffer.from(ICON).toString("base64") },
      },
    ]);
  });

  test("Install with the needs it lists places the mod at its pinned commit, approved, with its source kept", async () => {
    const { catalog, opts } = setup();
    await catalog.install("notes", ["panel", "net:api.example.com"]);
    const at = join(opts.folder, "notes");
    expect(readFileSync(join(at, "index.tsx"), "utf8")).toBe(notes["index.tsx"]);
    expect(JSON.parse(readFileSync(opts.approvals, "utf8")).approved).toEqual({ notes: { needs: ["net:api.example.com", "panel"], source: "github.com/kiwi-init/mods/notes" } });
    expect(JSON.parse(readFileSync(join(opts.folder, ".sources.json"), "utf8"))["notes"]).toMatchObject({ source: "github.com/kiwi-init/mods/notes", commit: COMMIT });
    expect((await catalog.list()).mods[0]?.installed).toBe(true);
    await expect(catalog.install("notes", ["panel", "net:api.example.com"])).rejects.toThrow("you already have a mod named notes");
  });

  test("a download that isn't the vouched copy is refused, with the reason, and nothing is left behind", async () => {
    const { catalog, opts, tamperWith } = setup();
    tamperWith((url, body) => (url.endsWith("/index.tsx") ? new TextEncoder().encode("top.evil = 1\n") : body));
    await expect(catalog.install("notes", ["panel", "net:api.example.com"])).rejects.toThrow("the download isn't the copy the catalog vouches for");
    expect(existsSync(join(opts.folder, "notes"))).toBe(false);
    expect(existsSync(opts.approvals)).toBe(false);
  });

  test("Install needs exactly what the catalog lists, and a mod.json that asks for more than its entry is refused", async () => {
    const { catalog } = setup();
    await expect(catalog.install("notes", ["panel"])).rejects.toThrow("approve exactly what notes asks for");
    await expect(catalog.install("ghost", [])).rejects.toThrow("the catalog has no mod named ghost");
    const greedy = setup(notes, { needs: ["panel"] });
    await expect(greedy.catalog.install("notes", ["panel"])).rejects.toThrow("its mod.json asks for panel, net:api.example.com, not what the catalog lists");
    expect(existsSync(join(greedy.opts.folder, "notes"))).toBe(false);
  });

  test("an unreachable catalog says so instead of listing nothing silently", async () => {
    const { catalog, goOffline } = setup();
    goOffline();
    expect(await catalog.list()).toEqual({ mods: [], why: "Channels couldn't read the catalog: offline" });
  });
});
