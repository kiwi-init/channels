import fs from "node:fs";
import path from "node:path";

import type { ModFetchReply, ModFetchRequest, ModView } from "./bridge.ts";
import { errorText, writePrivate } from "./guard.ts";
import { bundleMod } from "./mod-bundle.ts";
import { checkManifest, hostAllowed, unapproved } from "./mods.ts";

const MANIFEST_BYTES = 64_000;
const FETCH_BYTES = 8_000_000;
const FETCH_MS = 30_000;
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const DROPPED_HEADERS = new Set(["cookie", "cookie2", "host", "origin", "referer", "proxy-authorization", "connection", "content-length", "transfer-encoding"]);

interface Loaded {
  view: ModView;
  code: string | null;
}

export interface ModsHostOptions {
  folder: string;
  approvals: string;
  contract: string;
  push: (mods: ModView[]) => void;
  request?: typeof fetch;
}

function readApprovals(file: string): Record<string, string[]> {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    const approved = raw && typeof raw === "object" ? (raw as { approved?: unknown }).approved : null;
    if (!approved || typeof approved !== "object") return {};
    return Object.fromEntries(Object.entries(approved).filter((e): e is [string, string[]] => Array.isArray(e[1]) && e[1].every((n) => typeof n === "string")));
  } catch {
    // No approvals yet, or a file that isn't ours: every mod asks again.
    return {};
  }
}

async function loadOne(dir: string, name: string, contract: string, approved: readonly string[]): Promise<Loaded> {
  const off = (why: string, version: string | null = null, needs: string[] = []): Loaded => ({ view: { name, version, needs, approved: [], state: "off", why }, code: null });
  let raw: unknown;
  try {
    const file = path.join(dir, "mod.json");
    if (fs.statSync(file).size > MANIFEST_BYTES) return off("its mod.json is over 64 KB");
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return off(e instanceof SyntaxError ? "its mod.json isn't JSON" : "it has no mod.json");
  }
  const checked = checkManifest(raw, name, contract);
  if (!checked.ok) return off(checked.why);
  const { version, needs } = checked.manifest;
  const ok = needs.filter((n) => approved.includes(n));
  const asks = unapproved(needs, approved);
  if (asks.length) return { view: { name, version, needs, approved: ok, state: "asks" }, code: null };
  const built = await bundleMod(dir);
  if (!built.ok) return { view: { name, version, needs, approved: ok, state: "off", why: built.why }, code: null };
  return { view: { name, version, needs, approved: ok, state: "on", hash: built.hash }, code: built.code };
}

export function modsHost(o: ModsHostOptions) {
  let loaded = new Map<string, Loaded>();
  let scanning: Promise<void> | null = null;
  let again = false;
  let watcher: fs.FSWatcher | null = null;
  let parentWatcher: fs.FSWatcher | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function scan(): Promise<void> {
    const approvals = readApprovals(o.approvals);
    let names: string[];
    try {
      names = fs
        .readdirSync(o.folder, { withFileTypes: true })
        .filter((d) => !d.name.startsWith(".") && (d.isDirectory() || (d.isSymbolicLink() && fs.statSync(path.join(o.folder, d.name)).isDirectory())))
        .map((d) => d.name)
        .sort();
    } catch {
      // No mods folder yet: the app runs with none.
      names = [];
    }
    const next = new Map<string, Loaded>();
    for (const name of names) next.set(name, await loadOne(path.join(o.folder, name), name, o.contract, approvals[name] ?? []));
    loaded = next;
    o.push(list());
  }

  function rescan(): Promise<void> {
    if (scanning) {
      again = true;
      return scanning;
    }
    scanning = scan()
      .catch(() => undefined)
      .finally(() => {
        scanning = null;
        if (again) {
          again = false;
          void rescan();
        }
      });
    return scanning;
  }

  const soon = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void rescan();
    }, 150);
  };

  function watchFolder(): void {
    if (watcher) return;
    try {
      watcher = fs.watch(o.folder, { recursive: true }, soon);
      watcher.on("error", () => {
        watcher?.close();
        watcher = null;
      });
      soon();
    } catch {
      // The folder isn't there yet: its parent says when it appears.
      watcher = null;
    }
  }

  function list(): ModView[] {
    return [...loaded.values()].map((l) => l.view);
  }

  return {
    async start(): Promise<void> {
      await rescan();
      watchFolder();
      const parent = path.dirname(o.folder);
      try {
        parentWatcher = fs.watch(parent, (_, file) => {
          if (file === path.basename(o.folder)) watchFolder();
        });
      } catch {
        // Without the parent folder there is nothing to watch; mods appear on the next start.
        parentWatcher = null;
      }
    },
    stop(): void {
      watcher?.close();
      parentWatcher?.close();
      if (timer) clearTimeout(timer);
    },
    rescan,
    list,
    bundle(name: string): { code: string; hash: string } | null {
      const l = loaded.get(name);
      return l?.view.state === "on" && l.code !== null && l.view.hash ? { code: l.code, hash: l.view.hash } : null;
    },
    async approve(name: string, needs: readonly string[]): Promise<ModView[]> {
      const l = loaded.get(name);
      if (!l || l.view.state === "off") throw new Error(`there is no mod ${name} waiting for approval`);
      const asked = [...l.view.needs].sort();
      if (!Array.isArray(needs) || [...needs].sort().join("\n") !== asked.join("\n")) throw new Error(`approve exactly what ${name} asks for`);
      const approvals = readApprovals(o.approvals);
      approvals[name] = asked;
      writePrivate(o.approvals, Buffer.from(`${JSON.stringify({ approved: approvals }, null, 2)}\n`));
      await rescan();
      return list();
    },
    async fetch(name: string, req: ModFetchRequest): Promise<ModFetchReply> {
      const l = loaded.get(name);
      if (l?.view.state !== "on") throw new Error(`${name} isn't running`);
      if (!req || typeof req.url !== "string") throw new Error("a mod's fetch needs a URL");
      if (!hostAllowed(req.url, l.view.needs, l.view.approved)) throw new Error(`${name} may not reach ${req.url}: its host isn't one it listed and you approved`);
      const method = (req.method ?? "GET").toUpperCase();
      if (!METHODS.has(method)) throw new Error(`${name} may not send a ${method} request`);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers ?? {})) if (typeof v === "string" && !DROPPED_HEADERS.has(k.toLowerCase())) headers.set(k, v);
      const body = typeof req.body === "string" && method !== "GET" && method !== "HEAD" ? req.body : undefined;
      let res: Response;
      try {
        res = await (o.request ?? fetch)(req.url, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(FETCH_MS) });
      } catch (e) {
        throw new Error(`${name}'s request to ${new URL(req.url).hostname} failed: ${errorText(e)}`, { cause: e });
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > FETCH_BYTES) throw new Error(`${name}'s response was over 8 MB`);
      const out: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        if (k !== "set-cookie") out[k] = v;
      });
      return { status: res.status, statusText: res.statusText, headers: out, body: Buffer.from(bytes).toString("base64") };
    },
  };
}

export type ModsHost = ReturnType<typeof modsHost>;
