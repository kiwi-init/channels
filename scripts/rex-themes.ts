import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compose, contrast, hex, type ColorTheme, type Parts } from "../ui/src/theme/derive.ts";

const SOURCE = process.argv[2] ?? "/Applications/Rex Beta.app/Contents/Resources/SuperUI_SuperDesignTokens.bundle/Contents/Resources/themes.json";
const UI = resolve(import.meta.dir, "../ui");
const OUT = resolve(UI, "src/theme/rex-themes.ts");

interface Float {
  red: number;
  green: number;
  blue: number;
}

type Role = "live" | "doing" | "review" | "decide" | "alert" | "red" | "yellow" | "green" | "teal" | "blue" | "violet";

const BANDS: Record<Role, readonly [number, number, number]> = {
  live: [65, 170, 140],
  doing: [180, 265, 215],
  review: [245, 345, 275],
  decide: [25, 65, 40],
  alert: [335, 25, 4],
  red: [335, 25, 4],
  yellow: [30, 68, 42],
  green: [65, 170, 130],
  teal: [120, 205, 175],
  blue: [180, 265, 215],
  violet: [245, 345, 275],
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const isFloat = (v: unknown): v is Float => isRecord(v) && typeof v.red === "number" && typeof v.green === "number" && typeof v.blue === "number";

const byte = (n: number): string =>
  Math.round(Math.min(255, Math.max(0, n * 255)))
    .toString(16)
    .padStart(2, "0");

function color(semantic: Record<string, unknown>, key: string): string {
  const v = semantic[key];
  if (!isFloat(v)) throw new Error(`missing semantic.${key}`);
  return `#${byte(v.red)}${byte(v.green)}${byte(v.blue)}`;
}

function hsl(c: string): [number, number, number] {
  const n = parseInt(hex(c).slice(1), 16);
  const r = (n >> 16) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${byte(r + m)}${byte(g + m)}${byte(b + m)}`;
}

const guarded: string[] = [];

function guard(id: string, role: Role, c: string): string | undefined {
  const [h, s, l] = hsl(c);
  const [lo, hi, target] = BANDS[role];
  if (s < 0.12) {
    guarded.push(`${id} ${role}: grey, Channels colour`);
    return undefined;
  }
  const inside = lo < hi ? h >= lo && h <= hi : h >= lo || h <= hi;
  if (inside) return hex(c);
  guarded.push(`${id} ${role}: hue ${Math.round(h)} -> ${target}`);
  return fromHsl(target, s, l);
}

const raw: unknown = JSON.parse(readFileSync(SOURCE, "utf8"));
if (!Array.isArray(raw)) throw new Error("themes.json is not a list");

const nudged: string[] = [];
const themes: ColorTheme[] = raw.map((t: unknown): ColorTheme => {
  if (!isRecord(t) || typeof t.id !== "string" || typeof t.name !== "string" || (t.appearance !== "dark" && t.appearance !== "light")) throw new Error("bad theme");
  const { id, name, appearance } = t;
  const sem = t.semantic;
  const src = t.source;
  if (!isRecord(sem) || !isRecord(src) || !Array.isArray(src.ansi)) throw new Error(`${id}: no semantic tokens`);
  const ansi = src.ansi.map((a: unknown) => (typeof a === "string" ? a : "#000000"));
  const at = (i: number): string => ansi[i] ?? "#000000";
  const s = (key: string): string => color(sem, key);
  const ink = s("content");
  const bg2 = s("surfaceSubtle");
  const raised = s("surfaceRaised");
  const parts: Parts = {
    appearance,
    bg: s("canvas"),
    bg2,
    bg3: contrast(raised, ink) < contrast(bg2, ink) ? raised : undefined,
    ink,
    ink2: s("contentSecondary"),
    ink3: s("contentTertiary"),
    accent: s("accent"),
    live: guard(id, "live", s("success")),
    doing: guard(id, "doing", s("info")),
    review: guard(id, "review", at(5)),
    decide: guard(id, "decide", s("warning")),
    alert: guard(id, "alert", s("danger")),
    red: guard(id, "red", at(1)),
    yellow: guard(id, "yellow", at(3)),
    green: guard(id, "green", at(2)),
    teal: guard(id, "teal", at(6)),
    blue: guard(id, "blue", at(4)),
    violet: guard(id, "violet", at(5)),
  };
  const colors = compose(parts);
  const moved = (
    [
      ["ink", parts.ink],
      ["ink-2", parts.ink2],
      ["ink-3", parts.ink3],
      ["accent", parts.accent],
      ["live", parts.live],
      ["doing", parts.doing],
      ["review", parts.review],
      ["decide", parts.decide],
      ["alert", parts.alert],
      ["c-red", parts.red],
      ["c-yellow", parts.yellow],
      ["c-green", parts.green],
      ["c-teal", parts.teal],
      ["c-blue", parts.blue],
      ["c-violet", parts.violet],
    ] as const
  ).filter(([k, v]) => v !== undefined && hex(v) !== colors[k]);
  if (moved.length) nudged.push(`${id}: ${moved.map(([k]) => k).join(", ")}`);
  return { id, name, appearance, colors };
});

const body = themes.map((t) => `  ${JSON.stringify(t)},`).join("\n");
writeFileSync(OUT, `import type { ColorTheme } from "./derive"\n\nexport const REX_THEMES: readonly ColorTheme[] = [\n${body}\n]\n`);
Bun.spawnSync(["bunx", "oxfmt", OUT], { cwd: UI, stdout: "inherit", stderr: "inherit" });

console.log(`${themes.length} themes (${themes.filter((t) => t.appearance === "dark").length} dark) -> ${OUT}`);
console.log(`\nnudged for contrast:\n${nudged.join("\n")}`);
console.log(`\nhue guards:\n${guarded.join("\n")}`);
