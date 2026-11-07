import { folderHash, keepCopyIn } from "@kiwi/core/node/mod-folder.ts";
import { checkManifest, type ModManifest } from "@kiwi/core/node/mod-manifest.ts";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { preApprove } from "./mods-host.ts";

export interface Pinned {
  name: string;
  repo: string;
  path: string;
  commit: string;
  hash: string;
  files: readonly string[];
}

export interface PinnedOptions {
  folder: string;
  approvals: string;
  contract: string;
  request?: typeof fetch;
  raw?: string;
}

export const RAW = "https://raw.githubusercontent.com";

const FILES = 200;
const FILE_BYTES = 1_000_000;
const ALL_BYTES = 8_000_000;
const FETCH_MS = 30_000;

export async function get(request: typeof fetch, url: string): Promise<Response> {
  const res = await request(url, { signal: AbortSignal.timeout(FETCH_MS), headers: { "user-agent": "kiwi-channels" } });
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}${res.status === 404 ? " (is the repo public?)" : ""}`);
  return res;
}

export const rawUrl = (base: string, repo: string, commit: string, rel: string): string => `${base}/${repo}/${commit}/${rel.split("/").map(encodeURIComponent).join("/")}`;

async function download(pin: Pinned, into: string, request: typeof fetch, base: string): Promise<void> {
  if (!pin.files.length || pin.files.length > FILES) throw new Error(`the pin lists ${pin.files.length} files`);
  let total = 0;
  for (const rel of pin.files) {
    if (rel.split("/").some((p) => !p || p === "." || p === "..")) throw new Error(`${rel} isn't a plain path`);
    const bytes = new Uint8Array(await (await get(request, rawUrl(base, pin.repo, pin.commit, `${pin.path}/${rel}`))).arrayBuffer());
    total += bytes.byteLength;
    if (bytes.byteLength > FILE_BYTES || total > ALL_BYTES) throw new Error("the folder is too big");
    const at = path.join(into, rel);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, bytes);
  }
}

export const sourceOf = (pin: Pinned): string => `github.com/${pin.repo}/${pin.path}`;

export async function installPinned(pin: Pinned, o: PinnedOptions, copy: string, allow: (manifest: ModManifest) => readonly string[]): Promise<"placed" | "there"> {
  const at = path.join(o.folder, pin.name);
  fs.mkdirSync(o.folder, { recursive: true });
  const staged = path.join(o.folder, `.${pin.name}.placing-${randomBytes(6).toString("hex")}`);
  try {
    await download(pin, staged, o.request ?? fetch, o.raw ?? RAW);
    if (folderHash(staged) !== pin.hash) throw new Error(`the download isn't ${copy}`);
    const checked = checkManifest(JSON.parse(fs.readFileSync(path.join(staged, "mod.json"), "utf8")), pin.name, o.contract);
    if (!checked.ok) throw new Error(checked.why);
    const needs = allow(checked.manifest);
    if (fs.lstatSync(at, { throwIfNoEntry: false })) return "there";
    preApprove(o.approvals, pin.name, needs, sourceOf(pin));
    fs.renameSync(staged, at);
    keepCopyIn(o.folder, pin.name, { source: sourceOf(pin), url: `https://github.com/${pin.repo}.git`, path: pin.path, ref: null, commit: pin.commit, hash: pin.hash });
    return "placed";
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
}
