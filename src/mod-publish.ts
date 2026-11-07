import { folderHash } from "@kiwi/core/node/mod-folder.ts";
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkMod, KIT_TYPES_FILE, ModError, SCAFFOLD, type ModCheckReport } from "./mods.ts";

export const MODS_REPO = "kiwi-init/mods";

const FILES = 200;
const FILE_BYTES = 1_000_000;
const ALL_BYTES = 8_000_000;
const DOES_CHARS = 200;
const AUTHOR_CHARS = 100;
const FORK_WAIT_MS = 60_000;

export interface PublishOptions {
  home: string;
  only: string | null;
  cwd: string;
  token: string;
  api?: string;
  request?: typeof fetch;
  pause?: (ms: number) => Promise<void>;
}

export interface Published {
  name: string;
  version: string;
  report: ModCheckReport;
  commit: string;
  hash: string;
  files: string[];
  repo: string;
  branch: string;
  url: string;
  number: number;
  opened: boolean;
}

interface CatalogPin {
  name: string;
  does: string;
  add: string;
  needs: string[];
  commit: string;
  hash: string;
  files: string[];
  icon?: string;
  author?: string;
}

function publishedFiles(dir: string): string[] {
  const files: string[] = [];
  let bytes = 0;
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(dir, rel)).sort()) {
      if (entry.startsWith(".") || entry === "node_modules") continue;
      const path = rel ? `${rel}/${entry}` : entry;
      if (path === KIT_TYPES_FILE) continue;
      const st = lstatSync(join(dir, path));
      if (st.isSymbolicLink()) throw new ModError(`${path} is a link: a published mod holds plain files only`);
      if (st.isDirectory()) {
        walk(path);
        continue;
      }
      if (Object.hasOwn(SCAFFOLD, path) && readFileSync(join(dir, path), "utf8") === SCAFFOLD[path as keyof typeof SCAFFOLD]) continue;
      if (st.size > FILE_BYTES) throw new ModError(`${path} is over ${FILE_BYTES / 1_000_000} MB, more than Channels installs from the catalog`);
      bytes += st.size;
      files.push(path);
    }
  };
  walk("");
  if (files.length > FILES) throw new ModError(`it has ${files.length} files, and the catalog takes up to ${FILES}`);
  if (bytes > ALL_BYTES) throw new ModError(`its files add up to ${Math.round(bytes / 1_000_000)} MB, and the catalog takes up to ${ALL_BYTES / 1_000_000} MB`);
  return files;
}

function hashOf(dir: string, files: readonly string[]): string {
  const copy = mkdtempSync(join(tmpdir(), "kiwi-mod-publish-"));
  try {
    for (const f of files) {
      mkdirSync(dirname(join(copy, f)), { recursive: true });
      copyFileSync(join(dir, f), join(copy, f));
    }
    return folderHash(copy);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

function describedIn(dir: string): string {
  let raw: unknown;
  try {
    raw = (JSON.parse(readFileSync(join(dir, "mod.json"), "utf8")) as { description?: unknown } | null)?.description;
  } catch {
    // checkMod already read mod.json; a file that changed since reads as no description.
    raw = undefined;
  }
  const does = typeof raw === "string" ? raw.trim() : "";
  if (!does || does.length > DOES_CHARS || /[\u0000-\u001f\u007f]/.test(does))
    throw new ModError(`mod.json needs a "description": one line of up to ${DOES_CHARS} characters saying what it does, which From Kiwi shows`);
  return does;
}

function pinIn(catalog: unknown, pin: CatalogPin): { mods: unknown[] } & Record<string, unknown> {
  const all = catalog && typeof catalog === "object" && !Array.isArray(catalog) ? { ...(catalog as Record<string, unknown>) } : {};
  const mods = Array.isArray(all["mods"]) ? [...(all["mods"] as unknown[])] : [];
  const at = mods.findIndex((m) => !!m && typeof m === "object" && (m as { name?: unknown }).name === pin.name);
  if (at < 0) mods.push(pin);
  else mods[at] = pin;
  return { ...all, mods };
}

type Call = <T>(method: string, path: string, body?: unknown, ok?: readonly number[]) => Promise<{ status: number; json: T }>;

function github(o: PublishOptions): Call {
  const api = (o.api ?? "https://api.github.com").replace(/\/$/, "");
  const request = o.request ?? fetch;
  return async <T>(method: string, path: string, body?: unknown, ok: readonly number[] = []) => {
    const res = await request(`${api}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${o.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "kiwi-channels",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // GitHub answers JSON; anything else is said below by its status.
      json = null;
    }
    if (!res.ok && !ok.includes(res.status)) {
      const said = (json as { message?: unknown } | null)?.message;
      throw new ModError(`GitHub answered ${res.status} to ${method} ${path}${typeof said === "string" ? `: ${said}` : ""}`);
    }
    return { status: res.status, json: json as T };
  };
}

const later = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function forkOf(call: Call, branch: string, pause: (ms: number) => Promise<void>): Promise<string> {
  const { json } = await call<{ full_name: string }>("POST", `/repos/${MODS_REPO}/forks`, { default_branch_only: true });
  const end = Date.now() + FORK_WAIT_MS;
  while ((await call("GET", `/repos/${json.full_name}/git/ref/heads/${branch}`, undefined, [404, 409])).status !== 200) {
    if (Date.now() > end) throw new ModError(`GitHub hasn't finished making your fork ${json.full_name}: run kiwi mod publish again in a minute`);
    await pause(1_000);
  }
  await call("POST", `/repos/${json.full_name}/merge-upstream`, { branch }, [409, 422]);
  return json.full_name;
}

export async function publishMod(o: PublishOptions): Promise<Published> {
  const report = await checkMod(o.home, o.only, o.cwd);
  if (report.problems.length || !report.manifest)
    throw new ModError(`${report.name} doesn't check out (${report.problems.length} problem${report.problems.length === 1 ? "" : "s"}): kiwi mod check ${report.name} shows them`);
  const manifest = report.manifest;
  const does = describedIn(report.dir);
  const files = publishedFiles(report.dir);
  if (!files.includes("mod.json")) throw new ModError("its mod.json isn't among its files");
  if (manifest.icon && !files.includes(manifest.icon)) throw new ModError(`its icon ${manifest.icon} isn't among its files`);
  const hash = hashOf(report.dir, files);

  const call = github(o);
  const me = (await call<{ login: string }>("GET", "/user")).json.login;
  const upstream = (await call<{ default_branch: string; permissions?: { push?: boolean } }>("GET", `/repos/${MODS_REPO}`)).json;
  const repo = upstream.permissions?.push ? MODS_REPO : await forkOf(call, upstream.default_branch, o.pause ?? later);
  const owner = repo.split("/")[0]!;
  const base = (await call<{ object: { sha: string } }>("GET", `/repos/${MODS_REPO}/git/ref/heads/${upstream.default_branch}`)).json.object.sha;
  const baseTree = (await call<{ tree: { sha: string } }>("GET", `/repos/${MODS_REPO}/git/commits/${base}`)).json.tree.sha;
  const listed = (await call<{ tree: { path: string; type: string }[]; truncated?: boolean }>("GET", `/repos/${MODS_REPO}/git/trees/${baseTree}?recursive=1`)).json;
  if (listed.truncated) throw new ModError(`${MODS_REPO} is too big to read in one go: open the pull request by hand`);
  const gone = listed.tree.filter((e) => e.type === "blob" && e.path.startsWith(`${report.name}/`) && !files.includes(e.path.slice(report.name.length + 1))).map((e) => e.path);
  const index = (await call<{ content: string }>("GET", `/repos/${MODS_REPO}/contents/mods.json?ref=${base}`)).json;
  let catalog: unknown;
  try {
    catalog = JSON.parse(Buffer.from(index.content, "base64").toString("utf8"));
  } catch {
    // A mods.json that isn't JSON can't take an entry: the reviewer fixes it first.
    throw new ModError(`${MODS_REPO}'s mods.json isn't JSON`);
  }

  const blob = async (bytes: Buffer): Promise<string> => (await call<{ sha: string }>("POST", `/repos/${repo}/git/blobs`, { content: bytes.toString("base64"), encoding: "base64" })).json.sha;
  const entries: { path: string; mode: string; type: string; sha: string | null }[] = [];
  for (const f of files) entries.push({ path: `${report.name}/${f}`, mode: "100644", type: "blob", sha: await blob(readFileSync(join(report.dir, f))) });
  for (const p of gone) entries.push({ path: p, mode: "100644", type: "blob", sha: null });
  const folderTree = (await call<{ sha: string }>("POST", `/repos/${repo}/git/trees`, { base_tree: baseTree, tree: entries })).json.sha;
  const commit = (await call<{ sha: string }>("POST", `/repos/${repo}/git/commits`, { message: `${report.name} ${manifest.version}`, tree: folderTree, parents: [base] })).json.sha;

  const author = manifest.author ?? me;
  const pin: CatalogPin = {
    name: report.name,
    does,
    add: `kiwi mod add github.com/${MODS_REPO}/${report.name}`,
    needs: [...manifest.needs],
    commit,
    hash,
    files,
    ...(manifest.icon ? { icon: manifest.icon } : {}),
    ...(author.length <= AUTHOR_CHARS ? { author } : {}),
  };
  const text = `${JSON.stringify(pinIn(catalog, pin), null, 2)}\n`;
  const pinTree = (
    await call<{ sha: string }>("POST", `/repos/${repo}/git/trees`, {
      base_tree: folderTree,
      tree: [{ path: "mods.json", mode: "100644", type: "blob", sha: await blob(Buffer.from(text)) }],
    })
  ).json.sha;
  const head = (
    await call<{ sha: string }>("POST", `/repos/${repo}/git/commits`, {
      message: `mods.json: pin ${report.name} ${manifest.version} at ${commit.slice(0, 7)}`,
      tree: pinTree,
      parents: [commit],
    })
  ).json.sha;

  const branch = `publish-${report.name}`;
  const made = await call("POST", `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: head }, [422]);
  if (made.status === 422) await call("PATCH", `/repos/${repo}/git/refs/heads/${branch}`, { sha: head, force: true });

  const asks = manifest.needs.length ? manifest.needs.map((n) => `\`${n}\``).join(", ") : "nothing";
  const title = `${report.name} ${manifest.version}`;
  const body = [
    `**${title}:** ${does}`,
    "",
    `- **Asks for:** ${asks}`,
    `- **Pinned at** ${commit}: ${files.length} file${files.length === 1 ? "" : "s"}, folder hash \`${hash}\``,
    `- **Author:** ${author}`,
    "",
    `Opened with \`kiwi mod publish\`. Running it again moves this pull request to the new version.`,
  ].join("\n");
  const open = (await call<{ number: number; html_url: string }[]>("GET", `/repos/${MODS_REPO}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`)).json;
  if (open[0]) {
    await call("PATCH", `/repos/${MODS_REPO}/pulls/${open[0].number}`, { title, body });
    return { name: report.name, version: manifest.version, report, commit, hash, files, repo, branch, url: open[0].html_url, number: open[0].number, opened: false };
  }
  const pr = (
    await call<{ number: number; html_url: string }>("POST", `/repos/${MODS_REPO}/pulls`, {
      title,
      head: `${owner}:${branch}`,
      base: upstream.default_branch,
      body,
      ...(repo === MODS_REPO ? {} : { maintainer_can_modify: true }),
    })
  ).json;
  return { name: report.name, version: manifest.version, report, commit, hash, files, repo, branch, url: pr.html_url, number: pr.number, opened: true };
}
