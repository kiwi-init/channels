import { isAppPrefix } from "../mod-names.ts";

const MOD_NEEDS_OFFERED = ["panel", "sidebar", "command", "message-action", "net"] as const;

const NEED_KINDS = ["panel", "sidebar", "command", "message-action", "read", "post", "net"] as const;

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const ROOM = /^#?[a-z0-9][a-z0-9-]{0,63}$/;
const ICON = /^(?:[\w-][\w.-]*\/)*[\w-][\w.-]*\.(?:svg|png)$/i;
const AUTHOR_CHARS = 100;
const COMPARATOR = /^(?:\^|~|>=|<=|>|<|=)?\d+(?:\.(?:\d+|x|\*)){0,2}(?:-[0-9A-Za-z.-]+)?$/;

const isRange = (range: string): boolean =>
  range
    .trim()
    .split(/\s*\|\|\s*/)
    .every((part) => part.length > 0 && part.split(/\s+/).every((c) => COMPARATOR.test(c)));

export interface ModManifest {
  name: string;
  version: string;
  shell: string;
  needs: string[];
  icon?: string;
  author?: string;
}

export type ModCheck = { ok: true; manifest: ModManifest } | { ok: false; why: string };

export function needKind(need: string): (typeof NEED_KINDS)[number] | null {
  const colon = need.indexOf(":");
  const kind = colon < 0 ? need : need.slice(0, colon);
  const rest = colon < 0 ? null : need.slice(colon + 1);
  switch (kind) {
    case "panel":
    case "sidebar":
    case "command":
    case "message-action":
      return rest === null ? kind : null;
    case "read":
    case "post":
      return rest !== null && ROOM.test(rest) ? kind : null;
    case "net":
      return rest !== null && HOST.test(rest) ? kind : null;
    default:
      return null;
  }
}

export function netHosts(needs: readonly string[]): string[] {
  return needs.filter((n) => needKind(n) === "net").map((n) => n.slice("net:".length));
}

export function checkManifest(raw: unknown, folder: string, contract: string | null, offered: readonly string[] = MOD_NEEDS_OFFERED): ModCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, why: "mod.json isn't a JSON object" };
  const { name, version, shell, needs, icon, author } = raw as Record<string, unknown>;
  if (typeof name !== "string" || !NAME.test(name)) return { ok: false, why: "mod.json's name must be lowercase letters, digits and dashes" };
  if (isAppPrefix(name)) return { ok: false, why: `"${name}" is a name Channels keeps for its own commands: pick another` };
  if (name !== folder) return { ok: false, why: `mod.json names it "${name}", but its folder is "${folder}"` };
  if (typeof version !== "string" || !VERSION.test(version)) return { ok: false, why: "mod.json's version isn't a version like 1.0.0" };
  if (typeof shell !== "string" || !isRange(shell)) return { ok: false, why: "mod.json's shell isn't a version range, like ^3.3" };
  if (contract !== null && !Bun.semver.satisfies(contract, shell)) return { ok: false, why: `it needs shell ${shell}, and this app offers ${contract}` };
  if (icon !== undefined && (typeof icon !== "string" || icon.length > 200 || !ICON.test(icon)))
    return { ok: false, why: "mod.json's icon must be an .svg or .png file in the mod's folder, like icon.svg" };
  if (author !== undefined && (typeof author !== "string" || !author.trim() || author.length > AUTHOR_CHARS || /[\u0000-\u001f\u007f]/.test(author)))
    return { ok: false, why: `mod.json's author must be a name of up to ${AUTHOR_CHARS} characters on one line` };
  if (needs !== undefined && (!Array.isArray(needs) || needs.some((n) => typeof n !== "string"))) return { ok: false, why: "mod.json's needs must be a list of strings" };
  const list = [...new Set((needs ?? []) as string[])];
  for (const need of list) {
    const kind = needKind(need);
    if (!kind) return { ok: false, why: `it asks for "${need}", which isn't a capability` };
    if (!offered.includes(kind)) return { ok: false, why: `it needs "${need}", which this app doesn't offer yet` };
  }
  return { ok: true, manifest: { name, version, shell, needs: list, ...(icon ? { icon } : {}), ...(author ? { author: author.trim() } : {}) } };
}
