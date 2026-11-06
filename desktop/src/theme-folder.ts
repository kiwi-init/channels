import fs from "node:fs";
import path from "node:path";

import type { FolderThemeInput, FolderThemesView, FolderThemeView, ThemeColour } from "./bridge.ts";
import { isRecord, jsonFile, nameOf, readJsonFolder } from "./json-folder.ts";

const THEME_COLOURS: readonly ThemeColour[] = ["background", "text", "accent", "success", "warning", "danger", "info", "red", "yellow", "green", "cyan", "blue", "magenta"];
const REQUIRED: readonly ThemeColour[] = ["background", "text", "accent"];
const MAX_THEMES = 200;
const HEX = /^#[0-9a-f]{6}$/i;

export const themesDir = (home: string): string => path.join(home, "themes");

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
  return { file, name: nameOf(file, raw), appearance: raw["appearance"], base };
}

export function readFolder(dir: string): FolderThemesView {
  const { items, skipped } = readJsonFolder(dir, themeOf, MAX_THEMES, "themes");
  return { dir, themes: items, skipped };
}

const slug = (name: string): string =>
  name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40) || "theme";

export function writeTheme(dir: string, file: string | null, theme: FolderThemeInput): string {
  if (file !== null && !jsonFile(file)) throw new Error("a theme file is a plain name ending in .json");
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
  if (!jsonFile(file)) throw new Error("a theme file is a plain name ending in .json");
  fs.rmSync(path.join(dir, file), { force: true });
}
