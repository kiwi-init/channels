import type { Message } from "./protocol.ts";
import { humanOf, isPerson, ownerOf } from "./state/people.ts";
import type { ChannelState } from "./state/types.ts";

export interface PermissionShown {
  tool: string;
  command?: string;
  description?: string;
  sandbox?: "off";
  background?: true;
  paths?: string[];
  content?: string;
  replaced?: string;
  replaceAll?: true;
  url?: string;
  mcp?: { server: string; tool: string; args: string[]; values?: string[] };
  cwd: string;
  nonce: string;
  expiresAt: number;
  canAllow: boolean;
  call?: string;
}

export interface PermissionReply {
  ask: string;
  by: string;
  of: string;
  allow: boolean;
}

export type PermissionSettled = "terminal" | "timeout" | "ended";

export const PERMISSION_CHOICES = ["A: Allow once", "B: Deny"] as const;

export const permissionChoices = (x: unknown): boolean => JSON.stringify(x) === JSON.stringify(PERMISSION_CHOICES);

const COMMAND_MAX = 2_000;
const DESCRIPTION_MAX = 500;
const CONTENT_MAX = 4_000;
const VALUES_MAX = 2_000;
const PATHS_MAX = 20;
const PATH_MAX = 1_024;
const URL_MAX = 2_048;
const NAME_MAX = 200;
const ARGS_MAX = 50;
const ARG_MAX = 100;
const ASK_ID_MAX = 100;
const NONCE_RE = /^[A-Za-z0-9_-]{8,64}$/;
const CALL_RE = /^[A-Za-z0-9_-]{1,128}$/;
const SHOWN_URL = /^https?:\/\/\S+$/;
const SHOWN_KEYS: ReadonlySet<string> = new Set([
  "tool",
  "command",
  "description",
  "sandbox",
  "background",
  "paths",
  "content",
  "replaced",
  "replaceAll",
  "url",
  "mcp",
  "cwd",
  "nonce",
  "expiresAt",
  "canAllow",
  "call",
]);
const MCP_KEYS: ReadonlySet<string> = new Set(["server", "tool", "args", "values"]);
const REPLY_KEYS: ReadonlySet<string> = new Set(["ask", "by", "of", "allow"]);
const SIG_MAX = 200;
const SETTLED: ReadonlySet<unknown> = new Set(["terminal", "timeout", "ended"]);
const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const PATH_FIELDS = ["file_path", "notebook_path"] as const;
const ENV_FILE = /(?:^|[/\\])[^/\\]*\.env(?:\.[^/\\]*)?$/;
const REPLACING: ReadonlySet<string> = new Set(["Edit", "MultiEdit"]);

const UNSAFE_LINE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;
const UNSAFE_TEXT = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;
const UNSAFE_CONTENT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const line = (x: unknown, max: number): x is string => typeof x === "string" && x.length > 0 && x.length <= max && !UNSAFE_LINE.test(x);
const text = (x: unknown, max: number): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= max && !UNSAFE_TEXT.test(x);
const content = (x: unknown): x is string => typeof x === "string" && x.length <= CONTENT_MAX && !UNSAFE_CONTENT.test(x);
const lines = (x: unknown, most: number, max: number): x is string[] => Array.isArray(x) && x.length <= most && x.every((y) => line(y, max));
const time = (x: unknown): x is number => typeof x === "number" && Number.isFinite(new Date(x).getTime());
const flag = (x: unknown): x is boolean | undefined => x === undefined || typeof x === "boolean";
const total = (xs: readonly string[]) => xs.reduce((n, x) => n + x.length, 0);

const FLAGGED: readonly RegExp[] = [
  /(?<![A-Za-z0-9])(?:gh[oprsu]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})/,
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/,
  /(?<![A-Za-z0-9])(?:[sr]k_(?:live|test)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{20,})/,
  /(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{8,}/,
  /(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])/,
  /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}/,
  /(?<![A-Za-z0-9])glpat-[0-9A-Za-z_-]{16,}/,
  /(?<![A-Za-z0-9])(?:npm_[A-Za-z0-9]{30,}|hf_[A-Za-z0-9]{30,}|pypi-AgE[A-Za-z0-9_-]{20,}|ya29\.[A-Za-z0-9_-]{20,})/,
  /(?<!\d)\d{6,12}:[A-Za-z0-9_-]{30,}/,
  /hooks\.slack\.com\/(?:services|workflows|triggers)\/|discord(?:app)?\.com\/api\/webhooks\//i,
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]*/,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY/,
  /\bauthorization\s*[:=]/i,
  /(?<![\w-])(?:[\w-]*-api-key|api-key|apikey|private-token|x-auth-token|x-access-token|cookie|set-cookie)\s*:\s*\S/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/,
  /\bbearer\s+(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{8,}/i,
  /(?<![\w-])--(?:password|passwd|pass|token|secret|api-?key|api_key|access-token|auth-token|client-secret)(?:=\S|\s+[^\s-])/i,
  /(?<![\w-])kubectl(?![\w-])[^\n|;&]*\bsecret\b[^\n|;&]*--from-literal[=\s]/,
  /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s/?#@:]*:[^\s/?#@]+@/i,
  /(?<![a-z0-9+.-])https?:\/\/[^\s/?#@]+@/i,
  /(?<![\w-])(?:mysql[a-z]*|mariadb(?:-[a-z]+)?)(?![\w-])[^\n|;&]*\s-p[^\s]/,
  /(?<![\w-])sshpass(?:\s+-[^p\s]\S*)*\s+-p\s*[^\s-]/,
  /(?<![\w-])(?:docker|podman)\s+login(?![\w-])[^\n|;&]*\s-p\s*[^\s-]/,
  /(?<![\w-])redis-cli(?![\w-])[^\n|;&]*\s-a\s*[^\s-]/,
  /(?<![\w-])(?:-u|--user)(?:\s+|=)?["']?(?!\d+:\d+(?:["'\s]|$))[^\s"':]+:[^\s"']/,
  /(?:>>?|(?<![\w-])tee(?:\s+-a)?)\s*["']?(?:[^\s"'|;&<>]*\/)?(?:[\w-][\w.-]*)?\.env(?:\.[\w-]+)*["']?(?![^\s;|&)])/,
  /(?<![\w-])(?:[A-Z0-9_]*_)?(?:KEY|AUTH|CREDENTIALS?)\s*=(?!=)\s*["']?[^\s"']/,
  /[?&](?:key|auth|sig|signature|x-amz-signature|x-amz-security-token|x-goog-signature)=[^&\s#"']/i,
  /\bBasic\s+(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]+[A-Z0-9+/])(?:[A-Za-z0-9+/]{4}){3,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?(?![\w+/=])/,
  /(?<![\w-])gh\s+secret\s+set(?![\w-])[^\n|;&]*\s(?:--body|-b)(?:=|\s+)\S/,
  /(?<![\w-])openssl(?![\w-])[^\n|;&]*\s(?:-k\s+\S|-(?:pass|passin|passout)\s+pass:)/,
  /(?<![\w-])(?:echo|printf)\s[^\n|;&]*\|\s*sudo\s+(?:-[A-Za-z]+\s+)*-[A-Za-z]*S/,
];

const SECRET_NAME = String.raw`[\w-]*(?:token(?!s|iz)|secret|password|passwd|passphrase|(?<![a-z0-9])pass(?![a-z])|api[_-]?key|private[_-]?key|database[_-]?url)[\w-]*`;
const ASSIGNED = new RegExp(String.raw`(?<![\w-])${SECRET_NAME}\s*=(?!=)\s*["']?[^\s"']`, "i");
const KEYED = new RegExp(String.raw`(?:["']${SECRET_NAME}["']?|^[ \t]*${SECRET_NAME})\s*:\s*["']?[^\s"']`, "im");

const RUN = /[A-Za-z0-9+/_-]{40,}/g;
const RUN_SEPARATORS = /[+/_-]/;
const HEX = /^(?:0x)?[0-9a-fA-F]+$/;
const DIGEST_LABEL = /(?:sha(?:1|224|256|384|512)|sha3-(?:224|256|384|512)|blake2[bs]?|md5|digest|integrity)\s*[:=-]\s*["']?$/i;
const SRI = /^(?:sha(?:256|384|512)|sha3-(?:256|384|512)|blake2[bs]?)-/i;
const CHECKSUM_TOOL = /(?<![\w-])(?:sha(?:1|224|256|384|512)sum|shasum|b2sum|md5sum|cksum)(?![\w-])/;

const hexLength = (piece: string) => (HEX.test(piece) ? piece.replace(/^0x/, "").length : 0);

function charClass(c: number): number {
  if (c >= 48 && c <= 57) return 0;
  if (c >= 65 && c <= 90) return 1;
  return 2;
}

function readsRandom(pieces: readonly string[]): boolean {
  const seen = new Set<number>();
  let chars = 0;
  let pairs = 0;
  let switches = 0;
  for (const p of pieces.filter((piece) => hexLength(piece) < 8)) {
    chars += p.length;
    for (let i = 0; i < p.length; i++) {
      const c = charClass(p.charCodeAt(i));
      seen.add(c);
      if (i === 0) continue;
      pairs++;
      if (c !== charClass(p.charCodeAt(i - 1))) switches++;
    }
  }
  return chars >= 32 && seen.has(0) && seen.size >= 2 && switches >= pairs * 0.3;
}

function longRun(said: string): boolean {
  const summed = CHECKSUM_TOOL.test(said);
  for (const m of said.matchAll(RUN)) {
    if (DIGEST_LABEL.test(said.slice(Math.max(0, m.index - 24), m.index))) continue;
    const runs = m[0].startsWith("/") ? m[0].split("/").filter((part) => part.length >= 40) : [m[0]];
    for (const run of runs) {
      if (SRI.test(run)) continue;
      const pieces = run.split(RUN_SEPARATORS);
      if (!summed && pieces.some((p) => hexLength(p) > 40)) return true;
      if (readsRandom(pieces)) return true;
    }
  }
  return false;
}

function shapedSecret(said: string): boolean {
  return FLAGGED.some((re) => re.test(said)) || ASSIGNED.test(said) || KEYED.test(said);
}

export function looksSecret(said: string): boolean {
  return shapedSecret(said) || longRun(said);
}

function wellFormedMcp(x: unknown): x is NonNullable<PermissionShown["mcp"]> {
  if (!isRecord(x) || !Object.keys(x).every((k) => MCP_KEYS.has(k))) return false;
  if (!line(x.server, NAME_MAX) || !line(x.tool, NAME_MAX) || !lines(x.args, ARGS_MAX, ARG_MAX)) return false;
  return x.values === undefined || (lines(x.values, ARGS_MAX, VALUES_MAX) && x.values.length === x.args.length && total(x.values) <= VALUES_MAX);
}

export function wellFormedPermission(x: unknown): x is PermissionShown {
  if (!isRecord(x) || !Object.keys(x).every((k) => SHOWN_KEYS.has(k))) return false;
  const shaped =
    line(x.tool, NAME_MAX) &&
    line(x.cwd, PATH_MAX) &&
    typeof x.nonce === "string" &&
    NONCE_RE.test(x.nonce) &&
    time(x.expiresAt) &&
    typeof x.canAllow === "boolean" &&
    (x.command === undefined || text(x.command, COMMAND_MAX)) &&
    (x.description === undefined || text(x.description, DESCRIPTION_MAX)) &&
    (x.sandbox === undefined || x.sandbox === "off") &&
    (x.background === undefined || x.background === true) &&
    (x.paths === undefined || (lines(x.paths, PATHS_MAX, PATH_MAX) && x.paths.length > 0)) &&
    (x.content === undefined || content(x.content)) &&
    (x.replaced === undefined || content(x.replaced)) &&
    (x.replaceAll === undefined || x.replaceAll === true) &&
    (x.url === undefined || (line(x.url, URL_MAX) && SHOWN_URL.test(x.url))) &&
    (x.mcp === undefined || wellFormedMcp(x.mcp)) &&
    (x.call === undefined || (typeof x.call === "string" && CALL_RE.test(x.call)));
  const allSeen =
    x.sandbox === undefined &&
    (x.paths === undefined || x.content !== undefined) &&
    (typeof x.tool !== "string" || !REPLACING.has(x.tool) || x.replaced !== undefined) &&
    (x.mcp === undefined || (isRecord(x.mcp) && x.mcp.values !== undefined));
  return shaped && (x.canAllow === false || allSeen);
}

export function wellFormedPermReply(x: unknown): x is PermissionReply {
  return isRecord(x) && Object.keys(x).every((k) => REPLY_KEYS.has(k)) && line(x.ask, ASK_ID_MAX) && line(x.by, NAME_MAX) && line(x.of, SIG_MAX) && typeof x.allow === "boolean";
}

export function wellFormedSettled(x: unknown): x is PermissionSettled {
  return SETTLED.has(x);
}

type View = Omit<PermissionShown, "tool" | "cwd" | "nonce" | "expiresAt" | "call">;

function bashView(given: Record<string, unknown>): View | null {
  const { command, description, dangerouslyDisableSandbox: unsandboxed, run_in_background: background } = given;
  if (typeof command !== "string" || !flag(unsandboxed) || !flag(background)) return null;
  if (description !== undefined && typeof description !== "string") return null;
  return {
    command,
    ...(description?.trim() ? { description } : {}),
    ...(unsandboxed ? { sandbox: "off" as const } : {}),
    ...(background ? { background: true as const } : {}),
    canAllow: !unsandboxed,
  };
}

function writtenBy(tool: string, given: Record<string, unknown>): string | undefined | null {
  if (tool === "MultiEdit") {
    if (given.edits === undefined) return undefined;
    if (!Array.isArray(given.edits)) return null;
    const parts = given.edits.map((e: unknown) => (isRecord(e) && typeof e.new_string === "string" ? e.new_string : null));
    return parts.every((p): p is string => p !== null) ? parts.join("\n\n") : null;
  }
  const written = tool === "Write" ? given.content : tool === "Edit" ? given.new_string : given.new_source;
  return written === undefined || typeof written === "string" ? written : null;
}

function replacedBy(tool: string, given: Record<string, unknown>): { replaced?: string; all: boolean } | null {
  const edits = tool === "MultiEdit" ? given.edits : [given];
  if (!REPLACING.has(tool) || edits === undefined) return { all: false };
  if (!Array.isArray(edits)) return null;
  const olds: string[] = [];
  let all = false;
  for (const e of edits) {
    if (!isRecord(e) || (e.replace_all !== undefined && typeof e.replace_all !== "boolean")) return null;
    if (e.old_string !== undefined && typeof e.old_string !== "string") return null;
    if (typeof e.old_string === "string") olds.push(e.old_string);
    all ||= e.replace_all === true;
  }
  return olds.length === edits.length ? { replaced: olds.join("\n\n"), all } : { all };
}

function editView(tool: string, given: Record<string, unknown>): View | null {
  const paths: string[] = [];
  for (const field of PATH_FIELDS) {
    const path = given[field];
    if (path === undefined) continue;
    if (typeof path !== "string") return null;
    paths.push(path);
  }
  if (!paths.length || paths.some((p) => ENV_FILE.test(p))) return null;
  const written = writtenBy(tool, given);
  const swap = replacedBy(tool, given);
  if (written === null || swap === null) return null;
  const shownWritten = content(written);
  const shownReplaced = content(swap.replaced);
  return {
    paths,
    ...(shownWritten ? { content: written } : {}),
    ...(shownReplaced ? { replaced: swap.replaced } : {}),
    ...(swap.all ? { replaceAll: true as const } : {}),
    canAllow: shownWritten && (shownReplaced || !REPLACING.has(tool)),
  };
}

function fetchView(given: Record<string, unknown>): View | null {
  if (typeof given.url !== "string") return null;
  let url: URL;
  try {
    url = new URL(given.url);
  } catch {
    // Not a URL: there's nothing sensible to show, so the prompt stays in the terminal.
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
  return { url: url.href, canAllow: true };
}

function shownValue(x: unknown): string | null {
  try {
    return JSON.stringify(x) ?? null;
  } catch {
    // A value JSON can't write (a cycle, a BigInt) never came from a hook's JSON: show nothing.
    return null;
  }
}

function mcpName(tool: string, server: string | undefined): { server: string; tool: string } | null {
  if (server !== undefined) {
    for (const prefix of new Set([server, server.replace(/[^A-Za-z0-9_-]/g, "_")])) if (tool.startsWith(`mcp__${prefix}__`)) return { server, tool: tool.slice(prefix.length + 7) };
    return { server, tool };
  }
  const named = /^mcp__(.+?)__(.+)$/.exec(tool);
  return named?.[1] && named[2] ? { server: named[1], tool: named[2] } : null;
}

function mcpView(tool: string, given: Record<string, unknown>, server: unknown): View | null {
  if (server !== undefined && typeof server !== "string") return null;
  const named = mcpName(tool, server);
  if (!named) return null;
  const args = Object.keys(given);
  const values = args.map((k) => shownValue(given[k]));
  if (!values.every((v): v is string => v !== null)) return null;
  const visible = total(values) <= VALUES_MAX && lines(values, ARGS_MAX, VALUES_MAX);
  return { mcp: { ...named, args, ...(visible ? { values } : {}) }, canAllow: visible };
}

function viewOf(tool: string, given: unknown, server: unknown): View | null {
  if (!isRecord(given)) return null;
  if (tool.startsWith("mcp__")) return mcpView(tool, given, server);
  if (server !== undefined) return null;
  if (tool === "Bash") return bashView(given);
  if (EDIT_TOOLS.has(tool)) return editView(tool, given);
  if (tool === "WebFetch") return fetchView(given);
  return null;
}

function shownTexts(p: PermissionShown): string[] {
  const mcp = p.mcp ? [p.mcp.server, p.mcp.tool, ...p.mcp.args, ...(p.mcp.values ?? [])] : [];
  return [p.tool, p.command, p.description, p.content, p.replaced, p.url, ...mcp].filter((t): t is string => t !== undefined);
}

function revealsSecret(p: PermissionShown): boolean {
  return shownTexts(p).some(looksSecret) || [p.cwd, ...(p.paths ?? [])].some(shapedSecret);
}

export function permissionShown(input: unknown, nonce: string, expiresAt: number): PermissionShown | null {
  if (!isRecord(input)) return null;
  const { tool_name: tool, cwd } = input;
  if (typeof tool !== "string" || typeof cwd !== "string") return null;
  const view = viewOf(tool, input.tool_input, input.mcp_server);
  if (!view) return null;
  const shown: PermissionShown = { tool, ...view, cwd, nonce, expiresAt };
  return wellFormedPermission(shown) && !revealsSecret(shown) ? shown : null;
}

export function permissionReply(ask: Message, allow: boolean): PermissionReply | null {
  return ask.permission && ask.sig ? { ask: ask.id, by: ask.from, of: ask.sig, allow } : null;
}

export function permissionAnswer(ask: Message, reply: Message, state: Pick<ChannelState, "trust" | "members">): "allow" | "deny" | null {
  const shown = ask.permission;
  if (!shown || ask.esc !== true || state.trust.get(ask.seq) !== "verified") return null;
  const perm = reply.perm;
  if (
    !perm ||
    !ask.sig ||
    perm.ask !== ask.id ||
    perm.by !== ask.from ||
    perm.of !== ask.sig ||
    !reply.re?.includes(ask.seq) ||
    reply.seq <= ask.seq ||
    reply.from === ask.from ||
    reply.kind === "event"
  )
    return null;
  if (state.trust.get(reply.seq) !== "verified" || !ask.to?.includes(reply.from) || Math.max(reply.ts, reply.rts ?? reply.ts) > shown.expiresAt) return null;
  const replier = state.members.get(reply.from);
  if (!replier || !isPerson(replier)) return null;
  const human = humanOf(state, ask.from);
  if (perm.allow) return shown.canAllow && reply.from === human ? "allow" : null;
  return reply.from === human || reply.from === ownerOf(state) ? "deny" : null;
}
