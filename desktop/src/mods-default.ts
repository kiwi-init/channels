import { copiesIn, folderHash, keepCopyIn } from "@kiwi/core/node/mod-folder.ts";
import { checkManifest } from "@kiwi/core/node/mod-manifest.ts";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ModView } from "./bridge.ts";
import { errorText, writePrivate } from "./guard.ts";
import { readApprovals } from "./mods-host.ts";

export interface Pinned {
  name: string;
  repo: string;
  path: string;
  commit: string;
  hash: string;
}

export const DEFAULT_MODS: readonly Pinned[] = [
  { name: "github", repo: "kiwi-init/mods", path: "github", commit: "fef9c2d6fc23f8cce1d0986541362457e3f7e7d7", hash: "124adf9c7a7f821bbd5a9b353bd897d16f5763b822fc72cfb305474526c7f19a" },
];

export interface DefaultsOptions {
  folder: string;
  approvals: string;
  record: string;
  contract: string;
  pins?: readonly Pinned[];
  request?: typeof fetch;
}

const FILES = 200;
const FILE_BYTES = 1_000_000;
const ALL_BYTES = 8_000_000;
const FETCH_MS = 30_000;

interface Entry {
  path: string;
  mode: string;
  type: string;
  size?: number;
}

function readRecord(file: string): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    const done = raw && typeof raw === "object" ? (raw as { installed?: unknown }).installed : null;
    return done && typeof done === "object" ? Object.fromEntries(Object.entries(done).filter((e): e is [string, string] => typeof e[1] === "string")) : {};
  } catch {
    // Nothing installed by default yet.
    return {};
  }
}

async function get(request: typeof fetch, url: string): Promise<Response> {
  const res = await request(url, { signal: AbortSignal.timeout(FETCH_MS), headers: { "user-agent": "kiwi-channels" } });
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}${res.status === 404 ? " (is the repo public?)" : ""}`);
  return res;
}

async function download(pin: Pinned, into: string, request: typeof fetch): Promise<void> {
  const tree = (await (await get(request, `https://api.github.com/repos/${pin.repo}/git/trees/${pin.commit}?recursive=1`)).json()) as { tree?: Entry[]; truncated?: boolean };
  if (!Array.isArray(tree.tree) || tree.truncated) throw new Error("GitHub didn't list the whole folder");
  const files = tree.tree.filter((e) => e.path.startsWith(`${pin.path}/`) && e.type !== "tree");
  if (!files.length) throw new Error(`${pin.repo} has no folder ${pin.path} at ${pin.commit.slice(0, 7)}`);
  if (files.length > FILES) throw new Error(`the folder has over ${FILES} files`);
  let total = 0;
  for (const f of files) {
    const rel = f.path.slice(pin.path.length + 1);
    if (f.type !== "blob" || f.mode === "120000" || rel.split("/").some((p) => !p || p === "." || p === "..")) throw new Error(`${f.path} isn't a plain file`);
    const bytes = new Uint8Array(await (await get(request, `https://raw.githubusercontent.com/${pin.repo}/${pin.commit}/${f.path.split("/").map(encodeURIComponent).join("/")}`)).arrayBuffer());
    total += bytes.byteLength;
    if (bytes.byteLength > FILE_BYTES || total > ALL_BYTES) throw new Error("the folder is too big");
    const at = path.join(into, rel);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, bytes);
  }
}

async function installOne(pin: Pinned, o: DefaultsOptions): Promise<void> {
  const at = path.join(o.folder, pin.name);
  fs.mkdirSync(o.folder, { recursive: true });
  const staged = path.join(o.folder, `.${pin.name}.placing-${randomBytes(6).toString("hex")}`);
  try {
    await download(pin, staged, o.request ?? fetch);
    if (folderHash(staged) !== pin.hash) throw new Error("the download isn't the copy this app was built with");
    const checked = checkManifest(JSON.parse(fs.readFileSync(path.join(staged, "mod.json"), "utf8")), pin.name, o.contract);
    if (!checked.ok) throw new Error(checked.why);
    if (fs.lstatSync(at, { throwIfNoEntry: false })) return;
    const approvals = readApprovals(o.approvals);
    approvals[pin.name] = [...checked.manifest.needs].sort();
    writePrivate(o.approvals, Buffer.from(`${JSON.stringify({ approved: approvals }, null, 2)}\n`));
    fs.renameSync(staged, at);
    keepCopyIn(o.folder, pin.name, { source: `github.com/${pin.repo}/${pin.path}`, url: `https://github.com/${pin.repo}.git`, path: pin.path, ref: null, commit: pin.commit, hash: pin.hash });
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
}

/** Installs the mods that come with the app, once each, already approved; returns the ones that failed, as mods that are off and say why. */
export async function installDefaults(o: DefaultsOptions): Promise<ModView[]> {
  const failed: ModView[] = [];
  for (const pin of o.pins ?? DEFAULT_MODS) {
    const record = readRecord(o.record);
    if (record[pin.name]) continue;
    const there = fs.lstatSync(path.join(o.folder, pin.name), { throwIfNoEntry: false }) !== undefined || copiesIn(o.folder)[pin.name] !== undefined;
    try {
      if (!there) await installOne(pin, o);
      writePrivate(o.record, Buffer.from(`${JSON.stringify({ installed: { ...readRecord(o.record), [pin.name]: there ? "theirs" : pin.commit } }, null, 2)}\n`));
    } catch (e) {
      failed.push({ name: pin.name, version: null, needs: [], approved: [], state: "off", why: `it couldn't be installed: ${errorText(e)}. The app tries again when it starts` });
    }
  }
  return failed;
}
