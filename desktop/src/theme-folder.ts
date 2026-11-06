import fs from "node:fs";
import path from "node:path";

import type { FolderThemeInput, FolderThemesView, FolderThemeView, ThemeColour } from "./bridge.ts";

const THEME_COLOURS: readonly ThemeColour[] = ["background", "text", "accent", "success", "warning", "danger", "info", "red", "yellow", "green", "cyan", "blue", "magenta"];
const REQUIRED: readonly ThemeColour[] = ["background", "text", "accent"];
export const MAX_THEME_BYTES = 64 * 1024;
const MAX_THEMES = 200;
const HEX = /^#[0-9a-f]{6}$/i;
const FILE = /^[^./\\][^/\\]{0,79}\.json$/u;
const WAIT_MS = 150;

export const themesDir = (home: string): string => path.join(home, "themes");

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const themeFile = (file: string): boolean => FILE.test(file) && path.basename(file) === file;

export function themeOf(file: string, raw: unknown): FolderThemeView | string {
  if (!isRecord(raw)) return "isn't a JSON object";
  if (raw["appearance"] !== "dark" && raw["appearance"] !== "light") return 'needs "appearance": "dark" or "light"';
  const colours = raw["base"];
  if (!isRecord(colours)) return 'needs a "base" object with background, text and accent';
  for (const k of REQUIRED) if (colours[k] === undefined) return `needs "base.${k}", a colour like #1a2b3c`;
  const base: FolderThemeView["base"] = { background: "", text: "", accent: "" };
  for (const k of THEME_COLOURS) {
    const v = colours[k];
    if (v === undefined) continue;
    if (typeof v !== "string" || !HEX.test(v)) return `"base.${k}" isn't a colour like #1a2b3c`;
    base[k] = v.toLowerCase();
  }
  const named = typeof raw["name"] === "string" ? raw["name"].trim().slice(0, 60) : "";
  return { file, name: named || file.slice(0, -".json".length), appearance: raw["appearance"], base };
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON: readFolder lists the file as skipped, with that reason.
    return undefined;
  }
}

export function readFolder(dir: string): FolderThemesView {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    // No folder yet reads as no themes: it's made when the app starts watching.
    return { dir, themes: [], skipped: [] };
  }
  const themes: FolderThemeView[] = [];
  const skipped: FolderThemesView["skipped"] = [];
  for (const file of names.filter((n) => n.endsWith(".json") && !n.startsWith(".")).sort()) {
    if (!themeFile(file)) {
      skipped.push({ file, why: "has a name over 80 characters" });
      continue;
    }
    if (themes.length >= MAX_THEMES) {
      skipped.push({ file, why: `is past the first ${MAX_THEMES} themes` });
      continue;
    }
    const at = path.join(dir, file);
    let text: string;
    try {
      const stat = fs.statSync(at);
      if (!stat.isFile()) continue;
      if (stat.size > MAX_THEME_BYTES) {
        skipped.push({ file, why: "is over 64 KB" });
        continue;
      }
      text = fs.readFileSync(at, "utf8");
    } catch {
      // A file removed or locked between the listing and the read is skipped like a bad one.
      skipped.push({ file, why: "couldn't be read" });
      continue;
    }
    const raw = parsed(text);
    const theme = raw === undefined ? "isn't valid JSON" : themeOf(file, raw);
    if (typeof theme === "string") skipped.push({ file, why: theme });
    else themes.push(theme);
  }
  return { dir, themes, skipped };
}

export function watchFolder(dir: string, changed: () => void, stopped: () => void): () => void {
  fs.mkdirSync(dir, { recursive: true });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const watcher = fs.watch(dir, { persistent: false }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      changed();
    }, WAIT_MS);
  });
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    watcher.close();
  };
  watcher.on("error", () => {
    stop();
    stopped();
  });
  return stop;
}

const slug = (name: string): string =>
  name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40) || "theme";

export function writeTheme(dir: string, file: string | null, theme: FolderThemeInput): string {
  if (file !== null && !themeFile(file)) throw new Error("a theme file is a plain name ending in .json");
  const clean = themeOf(file ?? "theme.json", theme);
  if (typeof clean === "string") throw new Error(`that theme ${clean}`);
  fs.mkdirSync(dir, { recursive: true });
  let target = file;
  if (target === null) {
    const base = slug(clean.name);
    for (let n = 1; n < 1000 && target === null; n++) {
      const next = n === 1 ? `${base}.json` : `${base}-${n}.json`;
      if (!fs.existsSync(path.join(dir, next))) target = next;
    }
    if (target === null) throw new Error(`too many themes named ${base}`);
  }
  const body = { name: clean.name, appearance: clean.appearance, base: clean.base };
  const at = path.join(dir, target);
  const tmp = path.join(dir, `.${target}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
  fs.renameSync(tmp, at);
  return target;
}

export function removeTheme(dir: string, file: string): void {
  if (!themeFile(file)) throw new Error("a theme file is a plain name ending in .json");
  fs.rmSync(path.join(dir, file), { force: true });
}
