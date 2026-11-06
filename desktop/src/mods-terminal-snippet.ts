import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { writePrivate } from "./guard.ts";

type Env = Record<string, string | undefined>;

interface SnippetView {
  file: string;
  line: string;
  text: string;
}

export interface TerminalSnippets {
  hash: string;
  tmux?: SnippetView;
  rex?: SnippetView;
}

interface Placed {
  file: string;
  added: string;
  created: boolean;
}

interface Installed {
  hash: string;
  tmux?: Placed;
  rex?: Placed;
}

export interface SnippetHome {
  copies: string;
  record: string;
  home: string;
  env: Env;
}

const SNIPPET_BYTES = 16_000;
const PLAIN = /^[\t\n\r\x20-\x7e -￿]*$/;
const PATH_OK = /^\/[\x20-\x7e]{1,1023}$/;
const TMUX_FILE = path.join("terminal", "tmux.conf");
const REX_FILE = path.join("terminal", "rex.lua");

const tmuxQuoted = (s: string): string => `"${s.replace(/[\\"$]/g, (c) => `\\${c}`)}"`;
const luaQuoted = (s: string): string => `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`;

function tmuxConf(env: Env, home: string): string {
  const explicit = env["KIWI_TMUX_CONF"]?.trim();
  if (explicit) return explicit;
  const xdg = env["XDG_CONFIG_HOME"]?.trim();
  const confs = [path.join(home, ".tmux.conf"), ...(xdg ? [path.join(xdg, "tmux", "tmux.conf")] : []), path.join(home, ".config", "tmux", "tmux.conf")];
  return confs.find((c) => fs.existsSync(c)) ?? confs[0]!;
}

function rexInit(env: Env, home: string): string {
  const explicit = env["REX_CONFIG"]?.trim();
  if (explicit) return explicit;
  return path.join(env["XDG_CONFIG_HOME"]?.trim() || path.join(home, ".config"), "rex", "init.lua");
}

function readSnippet(file: string): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    // No snippet of this kind in the mod: nothing to add for it.
    return null;
  }
  if (!stat.isFile()) throw new Error(`${path.basename(file)} must be a plain file in the mod's terminal folder`);
  if (stat.size > SNIPPET_BYTES) throw new Error(`${path.basename(file)} is over 16 KB`);
  const text = fs.readFileSync(file, "utf8");
  if (!PLAIN.test(text)) throw new Error(`${path.basename(file)} holds control characters`);
  return text.endsWith("\n") || !text ? text : `${text}\n`;
}

const shown = (file: string, home: string): string => (file === home || file.startsWith(`${home}${path.sep}`) ? `~${file.slice(home.length)}` : file);

export function snippetsOf(modDir: string, name: string, at: SnippetHome): TerminalSnippets {
  const tmux = readSnippet(path.join(modDir, TMUX_FILE));
  const rex = readSnippet(path.join(modDir, REX_FILE));
  const copy = (kind: string): string => {
    const p = path.join(at.copies, name, kind);
    if (!PATH_OK.test(p)) throw new Error("the app's data folder has a path the terminal snippets can't name");
    return p;
  };
  const hash = createHash("sha256")
    .update(`tmux\u0000${tmux ?? ""}\u0000rex\u0000${rex ?? ""}`)
    .digest("hex")
    .slice(0, 16);
  return {
    hash,
    ...(tmux !== null ? { tmux: { file: shown(tmuxConf(at.env, at.home), at.home), line: `source-file -q ${tmuxQuoted(copy("tmux.conf"))} # Kiwi mod ${name}`, text: tmux } } : {}),
    ...(rex !== null ? { rex: { file: shown(rexInit(at.env, at.home), at.home), line: `pcall(dofile, ${luaQuoted(copy("rex.lua"))}) -- Kiwi mod ${name}`, text: rex } } : {}),
  };
}

function readRecord(file: string): Record<string, Installed> {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    const got = raw && typeof raw === "object" ? (raw as { installed?: unknown }).installed : null;
    return got && typeof got === "object" ? (got as Record<string, Installed>) : {};
  } catch {
    // Nothing installed yet, or a record that isn't ours: there is nothing to take back.
    return {};
  }
}

function writeRecord(file: string, all: Record<string, Installed>): void {
  writePrivate(file, Buffer.from(`${JSON.stringify({ installed: all }, null, 2)}\n`));
}

function realFile(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    // Not there yet: it's written where it's named.
    return file;
  }
}

function addLine(file: string, line: string): Placed {
  const real = realFile(file);
  const created = !fs.existsSync(real);
  const before = created ? "" : fs.readFileSync(real, "utf8");
  const added = `${before && !before.endsWith("\n") ? "\n" : ""}${line}\n`;
  if (created) fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.writeFileSync(real, before + added, created ? { mode: 0o644 } : {});
  return { file, added, created };
}

function takeLine(p: Placed): void {
  const real = realFile(p.file);
  let now: string;
  try {
    now = fs.readFileSync(real, "utf8");
  } catch {
    // The file is gone already: nothing of ours is left in it.
    return;
  }
  const at = now.lastIndexOf(p.added);
  let next: string;
  if (at >= 0) next = now.slice(0, at) + now.slice(at + p.added.length);
  else {
    const line = p.added.replace(/^\n/, "").replace(/\n$/, "");
    const lines = now.split("\n");
    const i = lines.lastIndexOf(line);
    if (i < 0) return;
    lines.splice(i, 1);
    next = lines.join("\n");
  }
  if (p.created && next === "") fs.rmSync(real, { force: true });
  else fs.writeFileSync(real, next);
}

export function installedHash(name: string, at: SnippetHome): string | null {
  return readRecord(at.record)[name]?.hash ?? null;
}

export function installSnippets(name: string, s: TerminalSnippets, at: SnippetHome): void {
  removeSnippets(name, at);
  const dir = path.join(at.copies, name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const done: Installed = { hash: s.hash };
  if (s.tmux) {
    fs.writeFileSync(path.join(dir, "tmux.conf"), s.tmux.text, { mode: 0o600 });
    done.tmux = addLine(tmuxConf(at.env, at.home), s.tmux.line);
  }
  if (s.rex) {
    fs.writeFileSync(path.join(dir, "rex.lua"), s.rex.text, { mode: 0o600 });
    done.rex = addLine(rexInit(at.env, at.home), s.rex.line);
  }
  const all = readRecord(at.record);
  all[name] = done;
  writeRecord(at.record, all);
}

export function removeSnippets(name: string, at: SnippetHome): boolean {
  const all = readRecord(at.record);
  const was = all[name];
  if (was?.tmux) takeLine(was.tmux);
  if (was?.rex) takeLine(was.rex);
  fs.rmSync(path.join(at.copies, name), { recursive: true, force: true });
  if (!was) return false;
  delete all[name];
  writeRecord(at.record, all);
  return true;
}

export function installedNames(at: SnippetHome): string[] {
  return Object.keys(readRecord(at.record));
}
