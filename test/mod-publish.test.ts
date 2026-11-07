import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { folderHash } from "@kiwi/core/node/mod-folder.ts";
import { MODS_REPO, publishMod } from "../src/mod-publish.ts";
import { KIT_TYPES_FILE, startDev } from "../src/mods.ts";

setDefaultTimeout(60_000);

const made: string[] = [];
const scratch = (tag: string): string => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-publish-${tag}-`));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

const sha = (kind: string, v: unknown): string =>
  createHash("sha1")
    .update(`${kind}\0${JSON.stringify(v)}`)
    .digest("hex");

function fakeGitHub(o: { login: string; push: boolean; catalog: unknown; folders?: Record<string, string> }) {
  const blobs = new Map<string, Buffer>();
  const trees = new Map<string, Map<string, string>>();
  const commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  const refs = new Map<string, string>();
  const pulls: { number: number; head: string; html_url: string; body: Record<string, unknown> }[] = [];
  const calls: Call[] = [];
  let forkReadyAfter = 2;

  const putBlob = (b: Buffer): string => {
    const s = sha("blob", b.toString("base64"));
    blobs.set(s, b);
    return s;
  };
  const putTree = (m: Map<string, string>): string => {
    const s = sha("tree", [...m].sort());
    trees.set(s, m);
    return s;
  };
  const start = new Map<string, string>([["mods.json", putBlob(Buffer.from(`${JSON.stringify(o.catalog, null, 2)}\n`))]]);
  for (const [p, text] of Object.entries(o.folders ?? {})) start.set(p, putBlob(Buffer.from(text)));
  const base = sha("commit", "base");
  commits.set(base, { tree: putTree(start), parents: [], message: "base" });
  refs.set(`${MODS_REPO}:heads/main`, base);
  const fork = `${o.login}/mods`;

  const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = `${url.pathname}${url.search}`;
      const body = req.method === "GET" ? null : ((await req.json()) as Record<string, unknown>);
      calls.push({ method: req.method, path, body });
      if (req.headers.get("authorization") !== "Bearer t0ken") return json(401, { message: "Bad credentials" });
      const repoOf = (rest: string) => {
        const m = /^\/repos\/([^/]+\/[^/]+)\/(.*)$/.exec(rest);
        return m ? { repo: m[1]!, tail: m[2]! } : null;
      };
      if (path === "/user") return json(200, { login: o.login });
      if (path === `/repos/${MODS_REPO}`) return json(200, { default_branch: "main", permissions: { push: o.push } });
      if (path === `/repos/${MODS_REPO}/forks`) return json(202, { full_name: fork });
      const at = repoOf(url.pathname);
      if (!at) return json(404, { message: "Not Found" });
      const { repo, tail } = at;
      if (repo === fork && o.push) return json(404, { message: "Not Found" });
      if (repo === fork && tail === "git/ref/heads/main" && forkReadyAfter-- > 0) return json(404, { message: "Not Found" });
      if (tail === "merge-upstream") {
        refs.set(`${repo}:heads/main`, refs.get(`${MODS_REPO}:heads/main`)!);
        return json(200, { merge_type: "fast-forward" });
      }
      const ref = /^git\/refs?\/heads\/(.+)$/.exec(tail);
      if (req.method === "GET" && ref) {
        const s = refs.get(`${repo}:heads/${ref[1]}`) ?? (repo === fork ? refs.get(`${MODS_REPO}:heads/${ref[1]}`) : undefined);
        return s ? json(200, { object: { sha: s } }) : json(404, { message: "Not Found" });
      }
      const commit = /^git\/commits\/([0-9a-f]+)$/.exec(tail);
      if (req.method === "GET" && commit) {
        const c = commits.get(commit[1]!);
        return c ? json(200, { sha: commit[1], tree: { sha: c.tree } }) : json(404, { message: "Not Found" });
      }
      const tree = /^git\/trees\/([0-9a-f]+)$/.exec(tail);
      if (req.method === "GET" && tree) {
        const t = trees.get(tree[1]!);
        return t ? json(200, { tree: [...t.keys()].map((p) => ({ path: p, type: "blob" })), truncated: false }) : json(404, { message: "Not Found" });
      }
      if (req.method === "GET" && tail === "contents/mods.json") {
        const c = commits.get(url.searchParams.get("ref") ?? "");
        const b = c && blobs.get(trees.get(c.tree)!.get("mods.json")!);
        return b ? json(200, { content: b.toString("base64") }) : json(404, { message: "Not Found" });
      }
      if (req.method === "POST" && tail === "git/blobs") return json(201, { sha: putBlob(Buffer.from(String(body!["content"]), "base64")) });
      if (req.method === "POST" && tail === "git/trees") {
        const next = new Map(trees.get(String(body!["base_tree"])) ?? []);
        for (const e of body!["tree"] as { path: string; sha: string | null }[]) {
          if (e.sha === null) next.delete(e.path);
          else next.set(e.path, e.sha);
        }
        return json(201, { sha: putTree(next) });
      }
      if (req.method === "POST" && tail === "git/commits") {
        const s = sha("commit", body);
        commits.set(s, { tree: String(body!["tree"]), parents: body!["parents"] as string[], message: String(body!["message"]) });
        return json(201, { sha: s });
      }
      if (req.method === "POST" && tail === "git/refs") {
        const name = String(body!["ref"]).replace(/^refs\//, "");
        if (refs.has(`${repo}:${name}`)) return json(422, { message: "Reference already exists" });
        refs.set(`${repo}:${name}`, String(body!["sha"]));
        return json(201, {});
      }
      if (req.method === "PATCH" && ref) {
        refs.set(`${repo}:heads/${ref[1]}`, String(body!["sha"]));
        return json(200, {});
      }
      if (repo === MODS_REPO && tail === "pulls" && req.method === "GET")
        return json(
          200,
          pulls.filter((p) => p.head === url.searchParams.get("head")),
        );
      if (repo === MODS_REPO && tail === "pulls" && req.method === "POST") {
        const pr = { number: 7 + pulls.length, head: String(body!["head"]), html_url: `https://github.com/${MODS_REPO}/pull/${7 + pulls.length}`, body: body! };
        pulls.push(pr);
        return json(201, pr);
      }
      return json(404, { message: `no fake for ${req.method} ${path}` });
    },
  });
  const read = (commitSha: string, p: string): Buffer | null => {
    const s = trees.get(commits.get(commitSha)!.tree)!.get(p);
    return s ? blobs.get(s)! : null;
  };
  const pathsAt = (commitSha: string): string[] => [...trees.get(commits.get(commitSha)!.tree)!.keys()].sort();
  return { api: `http://127.0.0.1:${server.port}`, server, calls, refs, commits, pulls, base, read, pathsAt, fork };
}

const CATALOG = {
  mods: [
    { name: "github", does: "the channel's GitHub tab", add: "kiwi mod add github.com/kiwi-init/mods/github", needs: ["tab"] },
    { name: "anatomy", does: "isometric figures", add: "kiwi mod add github.com/kiwi-init/mods/anatomy", needs: ["render:figure"] },
  ],
};

function standup(home: string): string {
  const dir = startDev(home, "standup-notes", scratch("cwd")).dir;
  const manifest = JSON.parse(readFileSync(join(dir, "mod.json"), "utf8")) as Record<string, unknown>;
  writeFileSync(join(dir, "mod.json"), JSON.stringify({ ...manifest, description: "keeps the day's standup notes beside the chat" }, null, 2));
  mkdirSync(join(dir, "parts"));
  writeFileSync(join(dir, "parts", "list.ts"), "export const items: string[] = []\n");
  mkdirSync(join(dir, "node_modules", "left-pad"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "left-pad", "index.js"), "module.exports = 1\n");
  writeFileSync(join(dir, ".DS_Store"), "x");
  return dir;
}

function installAt(gh: ReturnType<typeof fakeGitHub>, entry: { commit: string; files: string[] }, name: string): string {
  const into = scratch("installed");
  for (const f of entry.files) {
    const bytes = gh.read(entry.commit, `${name}/${f}`);
    if (!bytes) throw new Error(`${f} isn't at the pinned commit`);
    mkdirSync(dirname(join(into, f)), { recursive: true });
    writeFileSync(join(into, f), bytes);
  }
  return folderHash(into);
}

describe("kiwi mod publish", () => {
  test("from a fork: the folder in one commit, mods.json pinning that commit in the next, and a pull request to kiwi-init/mods", async () => {
    const home = scratch("home");
    const dir = standup(home);
    const gh = fakeGitHub({ login: "ada", push: false, catalog: CATALOG });
    try {
      const pauses: number[] = [];
      const p = await publishMod({ home, only: "standup-notes", cwd: scratch("cwd"), token: "t0ken", api: gh.api, pause: async (ms) => void pauses.push(ms) });

      expect(p.opened).toBe(true);
      expect(p.repo).toBe("ada/mods");
      expect(p.files).toEqual(["icon.svg", "index.tsx", "mod.json", "parts/list.ts"]);
      expect(p.files).not.toContain(KIT_TYPES_FILE);
      expect(pauses).toEqual([1_000, 1_000]);
      expect(gh.calls.some((c) => c.path === `/repos/ada/mods/merge-upstream`)).toBe(true);
      expect(gh.calls.filter((c) => c.method !== "GET" && c.path.startsWith(`/repos/${MODS_REPO}/git/`))).toEqual([]);

      const folder = gh.commits.get(p.commit)!;
      expect(folder.parents).toEqual([gh.base]);
      expect(folder.message).toBe("standup-notes 0.1.0");
      expect(gh.pathsAt(p.commit)).toEqual(["mods.json", "standup-notes/icon.svg", "standup-notes/index.tsx", "standup-notes/mod.json", "standup-notes/parts/list.ts"]);
      expect(gh.read(p.commit, "mods.json")!.toString()).toBe(`${JSON.stringify(CATALOG, null, 2)}\n`);

      const head = gh.refs.get("ada/mods:heads/publish-standup-notes")!;
      expect(gh.commits.get(head)!.parents).toEqual([p.commit]);
      const catalog = JSON.parse(gh.read(head, "mods.json")!.toString()) as { mods: Record<string, unknown>[] };
      expect(catalog.mods.map((m) => m["name"])).toEqual(["github", "anatomy", "standup-notes"]);
      expect(catalog.mods[2]).toEqual({
        name: "standup-notes",
        does: "keeps the day's standup notes beside the chat",
        add: "kiwi mod add github.com/kiwi-init/mods/standup-notes",
        needs: ["panel"],
        commit: p.commit,
        hash: p.hash,
        files: ["icon.svg", "index.tsx", "mod.json", "parts/list.ts"],
        icon: "icon.svg",
        author: "ada",
      });
      expect(installAt(gh, { commit: p.commit, files: p.files }, "standup-notes")).toBe(p.hash);

      expect(gh.pulls).toHaveLength(1);
      expect(gh.pulls[0]!.body).toMatchObject({ title: "standup-notes 0.1.0", head: "ada:publish-standup-notes", base: "main", maintainer_can_modify: true });
      expect(String(gh.pulls[0]!.body["body"])).toContain("keeps the day's standup notes beside the chat");
      expect(p.url).toBe(`https://github.com/${MODS_REPO}/pull/7`);

      const manifest = JSON.parse(readFileSync(join(dir, "mod.json"), "utf8")) as Record<string, unknown>;
      writeFileSync(join(dir, "mod.json"), JSON.stringify({ ...manifest, version: "0.2.0", author: "Ada Lovelace" }, null, 2));
      unlinkSync(join(dir, "parts", "list.ts"));
      gh.calls.length = 0;
      const again = await publishMod({ home, only: null, cwd: dir, token: "t0ken", api: gh.api, pause: async () => {} });

      expect(again.opened).toBe(false);
      expect(again.url).toBe(p.url);
      expect(gh.pulls).toHaveLength(1);
      expect(gh.calls.some((c) => c.method === "PATCH" && c.path === "/repos/ada/mods/git/refs/heads/publish-standup-notes" && c.body?.["force"] === true)).toBe(true);
      expect(gh.pathsAt(again.commit)).toEqual(["mods.json", "standup-notes/icon.svg", "standup-notes/index.tsx", "standup-notes/mod.json"]);
      const moved = JSON.parse(gh.read(gh.refs.get("ada/mods:heads/publish-standup-notes")!, "mods.json")!.toString()) as { mods: Record<string, unknown>[] };
      expect(moved.mods.map((m) => m["name"])).toEqual(["github", "anatomy", "standup-notes"]);
      expect(moved.mods[2]).toMatchObject({ commit: again.commit, hash: again.hash, files: ["icon.svg", "index.tsx", "mod.json"], author: "Ada Lovelace" });
      expect(installAt(gh, { commit: again.commit, files: again.files }, "standup-notes")).toBe(again.hash);
    } finally {
      gh.server.stop(true);
    }
  });

  test("with push access: the branch goes on kiwi-init/mods itself, a mod's old files go, and its entry moves in place", async () => {
    const home = scratch("home");
    standup(home);
    const gh = fakeGitHub({
      login: "jow",
      push: true,
      catalog: { mods: [{ name: "standup-notes", does: "old", add: "kiwi mod add github.com/kiwi-init/mods/standup-notes", needs: [] }, ...CATALOG.mods] },
      folders: { "standup-notes/old.ts": "export {}\n", "standup-notes/mod.json": "{}", "github/index.tsx": "export {}\n" },
    });
    try {
      const p = await publishMod({ home, only: "standup-notes", cwd: scratch("cwd"), token: "t0ken", api: gh.api });
      expect(p.repo).toBe(MODS_REPO);
      expect(gh.calls.some((c) => c.path.includes("/forks"))).toBe(false);
      expect(gh.pathsAt(p.commit)).toEqual(["github/index.tsx", "mods.json", "standup-notes/icon.svg", "standup-notes/index.tsx", "standup-notes/mod.json", "standup-notes/parts/list.ts"]);
      const catalog = JSON.parse(gh.read(gh.refs.get(`${MODS_REPO}:heads/publish-standup-notes`)!, "mods.json")!.toString()) as { mods: Record<string, unknown>[] };
      expect(catalog.mods.map((m) => m["name"])).toEqual(["standup-notes", "github", "anatomy"]);
      expect(catalog.mods[0]).toMatchObject({ does: "keeps the day's standup notes beside the chat", commit: p.commit, author: "jow" });
      expect(gh.pulls[0]!.body).toMatchObject({ head: "kiwi-init:publish-standup-notes" });
      expect(gh.pulls[0]!.body["maintainer_can_modify"]).toBeUndefined();
    } finally {
      gh.server.stop(true);
    }
  });

  test("it refuses before it reaches GitHub: no description, a link, a mod that doesn't check out", async () => {
    const gh = fakeGitHub({ login: "ada", push: false, catalog: CATALOG });
    const opts = (home: string) => ({ home, only: "standup-notes", cwd: scratch("cwd"), token: "t0ken", api: gh.api });
    try {
      const plain = scratch("home");
      const dir = startDev(plain, "standup-notes", scratch("cwd")).dir;
      await expect(publishMod(opts(plain))).rejects.toThrow('mod.json needs a "description": one line of up to 200 characters saying what it does, which From Kiwi shows');

      const linked = scratch("home");
      const ldir = standup(linked);
      symlinkSync(join(ldir, "index.tsx"), join(ldir, "parts", "again.tsx"));
      await expect(publishMod(opts(linked))).rejects.toThrow("parts/again.tsx is a link: a published mod holds plain files only");

      writeFileSync(join(dir, "index.tsx"), "export const = 1\n");
      const manifest = JSON.parse(readFileSync(join(dir, "mod.json"), "utf8")) as Record<string, unknown>;
      writeFileSync(join(dir, "mod.json"), JSON.stringify({ ...manifest, description: "notes" }));
      await expect(publishMod(opts(plain))).rejects.toThrow("standup-notes doesn't check out (1 problem): kiwi mod check standup-notes shows them");

      expect(gh.calls).toEqual([]);
    } finally {
      gh.server.stop(true);
    }
  });
});
