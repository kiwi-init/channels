import { bundleMod } from "@kiwi/core/node/mod-bundle.ts";
import { readModIcon, type IconType } from "@kiwi/core/node/mod-icon.ts";
import { checkManifest, type ModManifest, type ModSetting } from "@kiwi/core/node/mod-manifest.ts";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ModBundle, ModDetails, ModFetchReply, ModFetchRequest, ModIcon, ModSettingValue, ModView } from "./bridge.ts";
import { errorText, writePrivate } from "./guard.ts";
import { copyOf, kiwiKeys, modDetails } from "./mod-details.ts";
import { hostAllowed, SAFE_FILE, SAFE_FLAG, SAFE_LOOP, unapproved } from "./mods.ts";
import { installedHash, installedNames, installSnippets, removeSnippets, snippetsOf, type SnippetHome, type TerminalSnippets } from "./mods-terminal-snippet.ts";

const MANIFEST_BYTES = 64_000;
const FETCH_BYTES = 8_000_000;
const FETCH_MS = 30_000;
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const DROPPED_HEADERS = new Set(["cookie", "cookie2", "host", "origin", "referer", "proxy-authorization", "connection", "content-length", "transfer-encoding"]);

interface Loaded {
  view: ModView;
  code: string | null;
  art: { type: IconType; bytes: Uint8Array } | null;
  iconWhy: string | null;
  author: string | null;
  snippets?: TerminalSnippets;
  settings: ModSetting[];
}

export interface ModSecrets {
  read(mod: string, source: string): Record<string, string>;
  write(mod: string, source: string, id: string, value: string | null): void;
}

export function memorySecrets(): ModSecrets {
  const kept = new Map<string, { source: string; values: Record<string, string> }>();
  return {
    read: (mod, source) => (kept.get(mod)?.source === source ? { ...kept.get(mod)?.values } : {}),
    write: (mod, source, id, value) => {
      const now = kept.get(mod)?.source === source ? (kept.get(mod) ?? { source, values: {} }) : { source, values: {} };
      if (value === null) delete now.values[id];
      else now.values[id] = value;
      kept.set(mod, now);
    },
  };
}

export interface ModsHostOptions {
  folder: string;
  approvals: string;
  contract: string;
  push: (mods: ModView[]) => void;
  request?: typeof fetch;
  safe?: string | null;
  terminal?: SnippetHome;
  secrets?: ModSecrets;
  onTerminal?: (name: string, snippets: TerminalSnippets | null) => void;
}

interface Approval {
  needs: string[];
  source: string;
}

type Off = { by: "you" } | { by: "crash"; why: string; hash: string };

interface Values {
  source: string;
  set: Record<string, string | boolean>;
  rev: number;
}

interface ModsFile {
  approved: Record<string, Approval>;
  off: Record<string, Off>;
  values: Record<string, Values>;
  unsettledStarts: number;
}

const TEXT_CHARS = 2_000;
const SECRET_CHARS = 8_000;

const LOCAL_SOURCE = "local";
const LOOP_STARTS = 2;
const WHY_BYTES = 300;

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((n) => typeof n === "string");

function entries<T>(v: unknown, keep: (x: Record<string, unknown>) => T | null): Record<string, T> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, T> = {};
  for (const [k, x] of Object.entries(v)) {
    const kept = x && typeof x === "object" ? keep(x as Record<string, unknown>) : null;
    if (kept) out[k] = kept;
  }
  return out;
}

function readModsFile(file: string): ModsFile {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (parsed && typeof parsed === "object") raw = parsed as Record<string, unknown>;
  } catch {
    // No file yet, or one that isn't ours: every mod asks again.
  }
  return {
    approved: entries(raw["approved"], (a) => (strings(a["needs"]) && typeof a["source"] === "string" ? { needs: a["needs"], source: a["source"] } : null)),
    off: entries<Off>(raw["off"], (o) =>
      o["by"] === "you" ? { by: "you" } : o["by"] === "crash" && typeof o["why"] === "string" && typeof o["hash"] === "string" ? { by: "crash", why: o["why"], hash: o["hash"] } : null,
    ),
    values: entries<Values>(raw["values"], (v) =>
      typeof v["source"] === "string" && typeof v["rev"] === "number" && v["set"] && typeof v["set"] === "object"
        ? {
            source: v["source"],
            rev: v["rev"],
            set: Object.fromEntries(Object.entries(v["set"]).filter((e): e is [string, string | boolean] => typeof e[1] === "string" || typeof e[1] === "boolean")),
          }
        : null,
    ),
    unsettledStarts: typeof raw["unsettledStarts"] === "number" && raw["unsettledStarts"] > 0 ? raw["unsettledStarts"] : 0,
  };
}

const writeModsFile = (file: string, m: ModsFile): void => writePrivate(file, Buffer.from(`${JSON.stringify(m, null, 2)}\n`));

export function modSource(dir: string): string {
  if (fs.lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) return LOCAL_SOURCE;
  const keys = kiwiKeys(dir);
  const source = keys ? keys["source"] : copyOf(dir)?.["source"];
  return typeof source === "string" && source ? source : LOCAL_SOURCE;
}

const firstLine = (s: string): string => (s.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, WHY_BYTES);

function iconOf(dir: string, m: ModManifest): Pick<Loaded, "art" | "iconWhy"> {
  if (!m.icon) return { art: null, iconWhy: null };
  const got = readModIcon(dir, m.icon);
  return got.ok ? { art: { type: got.type, bytes: got.bytes }, iconWhy: null } : { art: null, iconWhy: got.why };
}

const iconHash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

const valuesOf = (file: ModsFile, name: string, source: string): Values | null => (file.values[name]?.source === source ? (file.values[name] ?? null) : null);

function filled(s: ModSetting, plain: Values | null, secret: Record<string, string>): boolean {
  if (s.type === "secret") return !!secret[s.id];
  const v = plain?.set[s.id];
  return s.type === "choice" ? typeof v === "string" && (s.choices ?? []).includes(v) : s.type === "text" ? typeof v === "string" && v !== "" : true;
}

function settingValues(list: readonly ModSetting[], plain: Values | null, secret: Record<string, string>): Record<string, ModSettingValue> {
  return Object.fromEntries(
    list.map((s) => {
      if (s.type === "secret") return [s.id, secret[s.id] ?? null];
      const v = plain?.set[s.id];
      if (s.type === "toggle") return [s.id, v === true];
      return [s.id, filled(s, plain, secret) && typeof v === "string" ? v : null];
    }),
  );
}

async function loadOne(dir: string, name: string, contract: string, file: ModsFile, safe: string | null, secrets: ModSecrets, terminal?: SnippetHome): Promise<Loaded> {
  const source = modSource(dir);
  const off = (why: string, version: string | null = null, needs: string[] = []): Loaded => ({
    view: { name, version, source, needs, approved: [], state: "off", why },
    code: null,
    art: null,
    iconWhy: null,
    author: null,
    settings: [],
  });
  let raw: unknown;
  try {
    const manifest = path.join(dir, "mod.json");
    if (fs.statSync(manifest).size > MANIFEST_BYTES) return off("its mod.json is over 64 KB");
    raw = JSON.parse(fs.readFileSync(manifest, "utf8"));
  } catch (e) {
    return off(e instanceof SyntaxError ? "its mod.json isn't JSON" : "it has no mod.json");
  }
  const checked = checkManifest(raw, name, contract);
  if (!checked.ok) return off(checked.why);
  const { version, needs } = checked.manifest;
  let snippets: TerminalSnippets | undefined;
  if (needs.includes("terminal")) {
    if (!terminal) return off("this app can't add a mod's terminal snippets", version, needs);
    try {
      snippets = snippetsOf(dir, name, terminal);
    } catch (e) {
      return off(errorText(e), version, needs);
    }
  }
  const shown = snippets ? { terminal: { hash: snippets.hash, ...(snippets.tmux ? { tmux: snippets.tmux } : {}), ...(snippets.rex ? { rex: snippets.rex } : {}) } } : {};
  const icon = iconOf(dir, checked.manifest);
  const settings = checked.manifest.settings ?? [];
  const done = (view: ModView, code: string | null = null): Loaded => ({ view, code, ...icon, author: checked.manifest.author ?? null, settings, ...(snippets ? { snippets } : {}) });
  const approval = file.approved[name];
  const approved = approval?.source === source ? approval.needs : [];
  const plain = valuesOf(file, name, source);
  const base = {
    name,
    version,
    source,
    needs,
    approved: needs.filter((n) => approved.includes(n)),
    ...(icon.art ? { icon: iconHash(icon.art.bytes) } : {}),
    ...shown,
    ...(settings.length ? { settingsRev: plain?.rev ?? 0 } : {}),
  };
  if (unapproved(needs, approved).length)
    return done(approval && approval.source !== source ? { ...base, state: "asks", why: `It comes from ${source} now, not ${approval.source}.` } : { ...base, state: "asks" });
  if (snippets && terminal && installedHash(name, terminal) !== snippets.hash) return done({ ...base, approved: base.approved.filter((n) => n !== "terminal"), state: "asks" });
  const secret = settings.some((s) => s.type === "secret") ? secrets.read(name, source) : {};
  const missing = settings.find((s) => s.required && !filled(s, plain, secret));
  if (missing) return done({ ...base, state: "off", off: "settings", why: `It needs its ${missing.title} setting: fill it in on its page in Settings → Mods.` });
  const stopped = file.off[name];
  if (stopped?.by === "you") return done({ ...base, state: "off", off: "you", why: "You switched it off." });
  if (safe) return done({ ...base, state: "off", off: "safe", why: safe });
  const built = await bundleMod(dir);
  if (!built.ok) return done({ ...base, state: "off", why: built.why });
  if (stopped?.by === "crash" && stopped.hash === built.hash) return done({ ...base, state: "off", off: "crash", why: `It stopped as it started: ${stopped.why}` });
  return done({ ...base, state: "on", hash: built.hash }, built.code);
}

export function modsHost(o: ModsHostOptions) {
  const secrets = o.secrets ?? memorySecrets();
  let loaded = new Map<string, Loaded>();
  let scanning: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  let watcher: fs.FSWatcher | null = null;
  let parentWatcher: fs.FSWatcher | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let safe: string | null = o.safe ?? null;
  let armed = false;
  let settled = false;

  async function scan(): Promise<void> {
    const file = readModsFile(o.approvals);
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
    for (const name of names) next.set(name, await loadOne(path.join(o.folder, name), name, o.contract, file, safe, secrets, o.terminal));
    loaded = next;
    if (o.terminal)
      for (const name of installedNames(o.terminal))
        if (!next.get(name)?.view.needs.includes("terminal") || !file.approved[name]?.needs.includes("terminal")) {
          try {
            if (removeSnippets(name, o.terminal)) o.onTerminal?.(name, null);
          } catch {
            // A config file we can't write now keeps its line; the next scan tries again.
          }
        }
    o.push(list());
  }

  function rescan(): Promise<void> {
    if (scanning) {
      queued ??= scanning.then(() => {
        queued = null;
        return rescan();
      });
      return queued;
    }
    scanning = scan()
      .catch(() => undefined)
      .finally(() => {
        scanning = null;
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

  const change = async (edit: (m: ModsFile) => void): Promise<ModView[]> => {
    const m = readModsFile(o.approvals);
    edit(m);
    writeModsFile(o.approvals, m);
    await rescan();
    return list();
  };

  return {
    async start(): Promise<void> {
      const flag = path.join(o.folder, SAFE_FLAG);
      if (fs.existsSync(flag)) {
        safe ??= SAFE_FILE;
        fs.rmSync(flag, { force: true });
      }
      const m = readModsFile(o.approvals);
      if (m.unsettledStarts >= LOOP_STARTS) {
        safe ??= SAFE_LOOP;
        writeModsFile(o.approvals, { ...m, unsettledStarts: 0 });
      }
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
    safe: (): string | null => safe,
    bundle(name: string): ModBundle | null {
      const l = loaded.get(name);
      if (l?.view.state !== "on" || l.code === null || !l.view.hash) return null;
      if (!armed) {
        armed = true;
        const m = readModsFile(o.approvals);
        writeModsFile(o.approvals, { ...m, unsettledStarts: m.unsettledStarts + 1 });
      }
      const plain = valuesOf(readModsFile(o.approvals), name, l.view.source);
      const secret = l.settings.some((s) => s.type === "secret") ? secrets.read(name, l.view.source) : {};
      return { code: l.code, hash: l.view.hash, settings: settingValues(l.settings, plain, secret) };
    },
    settled(): void {
      if (!armed || settled) return;
      settled = true;
      writeModsFile(o.approvals, { ...readModsFile(o.approvals), unsettledStarts: 0 });
    },
    icon(name: string): ModIcon | null {
      const art = loaded.get(name)?.art;
      return art ? { type: art.type, data: Buffer.from(art.bytes).toString("base64") } : null;
    },
    details(name: string): ModDetails | null {
      const l = loaded.get(name);
      if (!l) return null;
      const { version, source } = l.view;
      const plain = valuesOf(readModsFile(o.approvals), name, source);
      const secret = l.settings.some((s) => s.type === "secret") ? secrets.read(name, source) : {};
      const values = settingValues(l.settings, plain, secret);
      const settings = l.settings.map((s) => (s.type === "secret" ? { ...s, set: !!secret[s.id] } : { ...s, value: values[s.id] ?? null }));
      return modDetails(path.join(o.folder, name), { name, version, source, author: l.author, iconWhy: l.iconWhy, settings });
    },
    setSetting(name: string, id: string, value: unknown): Promise<ModView[]> {
      const l = loaded.get(name);
      const s = l?.settings.find((x) => x.id === id);
      if (!l || !s) return Promise.reject(new Error(`${name} has no setting ${id}`));
      const cleared = value === null || value === "";
      if (s.type === "toggle" ? typeof value !== "boolean" : !cleared && typeof value !== "string") return Promise.reject(new Error(`${s.title} takes ${s.type === "toggle" ? "on or off" : "text"}`));
      if (typeof value === "string" && value.length > (s.type === "secret" ? SECRET_CHARS : TEXT_CHARS)) return Promise.reject(new Error(`${s.title} is too long`));
      if (s.type === "choice" && !cleared && !(s.choices ?? []).includes(String(value))) return Promise.reject(new Error(`${s.title} has no choice "${String(value)}"`));
      const source = l.view.source;
      try {
        if (s.type === "secret") secrets.write(name, source, id, cleared ? null : String(value));
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
      return change((m) => {
        const was = m.values[name]?.source === source ? m.values[name] : undefined;
        const set = { ...was?.set };
        if (s.type !== "secret") {
          if (cleared) delete set[id];
          else set[id] = value as string | boolean;
        }
        m.values[name] = { source, set, rev: (was?.rev ?? 0) + 1 };
      });
    },
    failed(name: string, hash: string, why: string): Promise<ModView[]> {
      const l = loaded.get(name);
      if (l?.view.state !== "on" || l.view.hash !== hash) return Promise.resolve(list());
      return change((m) => {
        m.off[name] = { by: "crash", why: firstLine(String(why)) || "it gave no reason", hash };
      });
    },
    setOn(name: string, on: boolean): Promise<ModView[]> {
      if (!loaded.has(name)) return Promise.reject(new Error(`there is no mod ${name}`));
      return change((m) => {
        if (on) delete m.off[name];
        else m.off[name] = { by: "you" };
      });
    },
    async approve(name: string, needs: readonly string[]): Promise<ModView[]> {
      const l = loaded.get(name);
      if (!l || l.view.state === "off") throw new Error(`there is no mod ${name} waiting for approval`);
      const asked = [...l.view.needs].sort();
      if (!Array.isArray(needs) || [...needs].sort().join("\n") !== asked.join("\n")) throw new Error(`approve exactly what ${name} asks for`);
      const now = l.snippets && o.terminal ? snippetsOf(path.join(o.folder, name), name, o.terminal) : null;
      if (now && now.hash !== l.snippets?.hash) throw new Error(`${name}'s terminal snippets changed while you looked: look again`);
      const after = await change((m) => {
        m.approved[name] = { needs: asked, source: l.view.source };
        delete m.off[name];
      });
      if (!now || !o.terminal) return after;
      installSnippets(name, now, o.terminal);
      o.onTerminal?.(name, now);
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
