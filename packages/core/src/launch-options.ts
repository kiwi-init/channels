export const PERMISSIONS = ["default", "accept-edits", "plan", "bypass"] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface LaunchChoices {
  model?: string;
  effort?: string;
  permission?: Permission;
  context?: number;
}

export interface HarnessOptions {
  model: boolean;
  effort: string[];
  permission: Permission[];
  context: number[];
}

export const CHOICE_KEYS = ["model", "effort", "permission", "context"] as const;

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/;
const EFFORT = /^[a-z]{1,16}$/;
const CONTEXT_MIN = 1_000;
const CONTEXT_MAX = 10_000_000;

const isPermission = (v: unknown): v is Permission => typeof v === "string" && (PERMISSIONS as readonly string[]).includes(v);

const isModel = (v: unknown): v is string => typeof v === "string" && MODEL.test(v);

const isEffort = (v: unknown): v is string => typeof v === "string" && EFFORT.test(v);

const isContext = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= CONTEXT_MIN && v <= CONTEXT_MAX;

export function choicesOf({ model, effort, permission, context }: LaunchChoices): LaunchChoices {
  return { ...(model !== undefined ? { model } : {}), ...(effort !== undefined ? { effort } : {}), ...(permission !== undefined ? { permission } : {}), ...(context !== undefined ? { context } : {}) };
}

export function readLaunchChoices(x: Record<string, unknown>): LaunchChoices | null {
  const { model, effort, permission, context } = x;
  if ((model !== undefined && !isModel(model)) || (effort !== undefined && !isEffort(effort))) return null;
  if ((permission !== undefined && !isPermission(permission)) || (context !== undefined && !isContext(context))) return null;
  return choicesOf({ model, effort, permission, context });
}

export function readHarnessOptions(x: unknown): HarnessOptions | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.model !== "boolean" || !Array.isArray(o.effort) || !Array.isArray(o.permission) || !Array.isArray(o.context)) return null;
  return { model: o.model, effort: o.effort.filter(isEffort), permission: o.permission.filter(isPermission), context: o.context.filter(isContext) };
}

export function contextWords(tokens: number): string {
  if (tokens % 1_000_000 === 0) return `${tokens / 1_000_000}m`;
  return tokens % 1_000 === 0 ? `${tokens / 1_000}k` : String(tokens);
}

export function readContext(text: string): number | null {
  const m = /^(\d{1,8})([km]?)$/i.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]) * (m[2]?.toLowerCase() === "m" ? 1_000_000 : m[2] ? 1_000 : 1);
  return isContext(n) ? n : null;
}

const NONE = { effort: "an effort level", permission: "a permission mode", context: "a context size" } as const;

export function choicesRefusal(name: string, options: HarnessOptions, c: LaunchChoices): string | null {
  const one = (what: keyof typeof NONE, value: string, takes: readonly string[]): string =>
    takes.length ? `${name} takes ${what} ${takes.join(", ")}, not ${value}` : `${name} doesn't take ${NONE[what]} from Kiwi`;
  if (c.model !== undefined && !options.model) return `${name} doesn't take a model from Kiwi`;
  if (c.effort !== undefined && !options.effort.includes(c.effort)) return one("effort", c.effort, options.effort);
  if (c.permission !== undefined && !options.permission.includes(c.permission)) return one("permission", c.permission, options.permission);
  if (c.context !== undefined && !options.context.includes(c.context)) return one("context", contextWords(c.context), options.context.map(contextWords));
  return null;
}
