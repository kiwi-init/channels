import { cleanPersona, type Personality } from "./personality.ts";
import { PRESETS } from "./presets.ts";

const MAX_ID = 40;
export const MAX_PERSONALITIES = 50;

export const PRESET_IDS: ReadonlySet<string> = new Set(PRESETS.map((p) => p.id));

const ID = /^[a-z0-9][a-z0-9-]*$/;

function glyphOf(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const chars = [...x.trim()];
  return chars.length === 1 && !/\s/.test(chars[0]!) ? chars[0]! : null;
}

export function cleanPersonality(x: unknown): Personality | null {
  const persona = cleanPersona(x);
  if (!persona || !x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const glyph = glyphOf(r.glyph);
  if (typeof r.id !== "string" || r.id.length > MAX_ID || !ID.test(r.id) || !glyph) return null;
  return { id: r.id, glyph, ...persona };
}

export function cleanPersonalities(x: unknown): Personality[] {
  if (!Array.isArray(x)) return [];
  const seen = new Set<string>(PRESET_IDS);
  const out: Personality[] = [];
  for (const item of x) {
    const p = cleanPersonality(item);
    if (!p || seen.has(p.id) || out.length >= MAX_PERSONALITIES) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

export function freeId(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_ID - 4) || "personality";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export function copyOf(p: Personality, taken: ReadonlySet<string>): Personality {
  const name = `${p.name} copy`.slice(0, 40);
  return { ...p, id: freeId(name, taken), name, capabilities: [...p.capabilities], areas: [...p.areas] };
}
