// What `kiwi tui` prints into the scrollback: messages, events, notices and command output, as
// styled lines at a given width. Every member-written string passes through `clean` first, so no
// message can move the cursor, recolour the screen or pose as another line.

import { ago, cleanBody, describeEvent } from "../format.ts";
import { inlineText } from "../membership.ts";
import { GENERAL_ROOM, type Message } from "../protocol.ts";
import { colorOf, isPerson, type ChannelState } from "../state.ts";
import { accent, bad, bold, code, dim, faint, fg, good, graphemes, italic, MEMBER_COLORS, muted, truncate, warn, width, wrap, type Style } from "./term.ts";

/** Member-written text, safe to print: no control characters, tabs as spaces. */
export function clean(s: unknown): string {
  return cleanBody(String(s ?? "")).replace(/\t/g, "  ");
}

/** A short clock time for today, a date for anything older. */
export function when(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const today = new Date(now).toDateString() === d.toDateString();
  const hm = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return today ? hm : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${hm}`;
}

const FALLBACK = ["#60a5fa", "#2dd4bf", "#a78bfa", "#f472b6", "#fb923c", "#4ade80"];

/** The colour a member's name wears: their person's, else one picked from the name. */
export function nameStyle(state: ChannelState, name: string): Style {
  const c = colorOf(state, name);
  if (c) return fg(MEMBER_COLORS[c] ?? "#cccccc");
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return fg(FALLBACK[h % FALLBACK.length]!);
}

/** "Jonatas" for a person with a display name, else the member name. */
export function displayName(state: ChannelState, name: string): string {
  const m = state.members.get(name);
  return inlineText(m?.kind === "human" && m.display ? m.display : name, 40) || "?";
}

/** Light markdown, one visual line at a time: `code`, **bold**, headings and bullets. */
function inline(line: string, inCode: boolean): string {
  if (inCode) return code(line);
  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  if (heading) return bold(heading[2]!);
  return line
    .replace(/^(\s*)[-*]\s+/, (_a, sp: string) => `${sp}• `)
    .replace(/`([^`]+)`/g, (_a, c: string) => code(c))
    .replace(/\*\*([^*]+)\*\*/g, (_a, b: string) => bold(b));
}

/** A body as indented, wrapped lines, fenced code kept apart. */
export function bodyLines(body: string, cols: number, indent = "  "): string[] {
  const out: string[] = [];
  let inCode = false;
  for (const raw of clean(body).split("\n")) {
    if (/^\s*```/.test(raw)) {
      inCode = !inCode;
      continue;
    }
    const wrapped = wrap(raw, cols - width(indent));
    for (const l of wrapped) out.push(indent + inline(l, inCode));
  }
  while (out.length && !out.at(-1)!.trim()) out.pop();
  return out.length ? out : [indent + faint("(empty)")];
}

export interface MessageContext {
  state: ChannelState;
  me: string;
  /** Who the person talks with in coordinator-only mode (their view hides "→ you"). */
  coordinator: string | null;
  now?: number;
}

/** A chat message: a header (who, what kind, when, its number) and its body. */
export function messageLines(m: Message, ctx: MessageContext, cols: number): string[] {
  const { state, me } = ctx;
  if (m.from === me) return mine(m, ctx, cols);
  const who = nameStyle(state, m.from);
  const member = state.members.get(m.from);
  const role = member?.role ? inlineText(member.role, 30) : member && isPerson(member) ? "person" : "";
  const bits: string[] = [];
  if (role) bits.push(role);
  const to = m.to?.filter((t) => t !== me) ?? [];
  if (m.to?.includes("*")) bits.push("to everyone");
  else if (to.length) bits.push(`→ ${to.map((t) => inlineText(t, 30)).join(", ")}`);
  const room = roomLabel(m, state);
  if (room) bits.push(room);
  if (m.re?.length) bits.push(`re #${m.re.map((n) => Number(n) || 0).join(", #")}`);
  bits.push(when(m.rts ?? m.ts, ctx.now));
  bits.push(`#${m.seq}`);
  const badge = KIND_BADGE[m.kind]?.() ?? "";
  const direct = state.direct.has(m.seq) && ctx.coordinator ? ` ${warn(`not through ${inlineText(ctx.coordinator, 30)}`)}` : "";
  const head = `${who("●")} ${bold(who(displayName(state, m.from)))}${badge ? ` ${badge}` : ""}${direct}  ${faint(bits.join(" · "))}`;
  // A question for this person says how to answer it.
  const forMe = (m.kind === "ask" || m.kind === "blocking") && (!m.to?.length || m.to.includes(me) || m.to.includes("*")) && state.openAsks.some((a) => a.seq === m.seq);
  return [fit(head, cols), ...bodyLines(m.body, cols), ...images(m), ...(forMe ? [`  ${faint(`↳ /reply ${m.seq} to answer`)}`] : [])];
}

const KIND_BADGE: Partial<Record<Message["kind"], () => string>> = {
  ask: () => warn("asks"),
  blocking: () => bad("is blocked"),
  done: () => good("✓ done"),
  status: () => muted("status"),
  ack: () => muted("ok"),
};

/** The person's own message, the way Claude Code echoes a prompt. */
function mine(m: Message, ctx: MessageContext, cols: number): string[] {
  const lines = wrap(clean(m.body), cols - 2);
  const to = m.to?.filter((t) => t !== ctx.coordinator) ?? [];
  const tail = [m.kind === "ask" ? "asked" : "", m.re?.length ? `re #${m.re.map((n) => Number(n) || 0).join(", #")}` : "", to.length ? `→ ${to.map((t) => inlineText(t, 30)).join(", ")}` : m.to?.includes("*") ? "to everyone" : "", roomLabel(m, ctx.state), `#${m.seq}`]
    .filter(Boolean)
    .join(" · ");
  const out = lines.map((l, i) => muted(i === 0 ? `> ${l}` : `  ${l}`));
  // Its number goes on the last line when it fits there.
  const last = lines.at(-1) ?? "";
  if (width(last) + 2 + 2 + width(tail) <= cols) out[out.length - 1] += `  ${faint(tail)}`;
  else out.push(`  ${faint(tail)}`);
  return [...out, ...images(m)];
}

function roomLabel(m: Message, state: ChannelState): string {
  if (state.rooms.size < 2 || m.kind === "event") return "";
  const id = state.roomOf.get(m.seq) ?? m.room ?? GENERAL_ROOM;
  return `#${inlineText(state.rooms.get(id)?.name ?? id, 30)}`;
}

function images(m: Message): string[] {
  if (!m.imgs?.length) return [];
  return [`  ${faint(`▣ ${m.imgs.map((i) => inlineText(i.name, 60)).join(", ")} · /show ${m.seq} saves ${m.imgs.length === 1 ? "it" : "them"}`)}`];
}

/** A coordination event as one muted row. */
export function eventLines(m: Message, state: ChannelState, cols: number): string[] {
  const text = `${displayName(state, m.from)} ${inlineText(describeEvent(m, state), 400)}`;
  return wrap(text, cols - 5).map((l, i) => faint(i === 0 ? `  ⎿  ${l}` : `     ${l}`));
}

/** Command output, under the command like a tool result. */
export function resultLines(text: string, cols: number, style: Style = (s) => s): string[] {
  const lines = clean(text)
    .split("\n")
    .flatMap((l) => wrap(l, cols - 5));
  return lines.map((l, i) => (i === 0 ? `${faint("  ⎿  ")}${style(l)}` : `     ${style(l)}`));
}

/** Something the person must act on, like a join request. */
export function noticeLines(title: string, body: string, cols: number): string[] {
  return [fit(`${warn("◆")} ${bold(title)}`, cols), ...resultLines(body, cols)];
}

/** The welcome box, like Claude Code's. */
export function bannerLines(rows: { channel: string; you: string; mode: string | null; relay: string }, cols: number): string[] {
  const inner = Math.max(20, Math.min(cols, 72) - 4);
  const line = (s: string) => `${faint("│")} ${s}${" ".repeat(Math.max(0, inner - width(s)))} ${faint("│")}`;
  const body = [
    `${accent("✻")} Welcome to ${bold("Kiwi Channels")}`,
    "",
    dim(italic(truncate("/help for commands · shift+tab switches views · ctrl+c to quit", inner))),
    "",
    `${muted("channel")} ${truncate(rows.channel, inner - 8)}`,
    `${muted("you    ")} ${truncate(rows.you, inner - 8)}`,
    ...(rows.mode ? [`${muted("mode   ")} ${truncate(rows.mode, inner - 8)}`] : []),
    `${muted("relay  ")} ${truncate(rows.relay, inner - 8)}`,
  ];
  return [faint(`╭${"─".repeat(inner + 2)}╮`), ...body.map(line), faint(`╰${"─".repeat(inner + 2)}╯`)];
}

/** A header line that's too long loses its tail, not its colours' ends. */
function fit(s: string, cols: number): string {
  return width(s) <= cols ? s : truncateStyled(s, cols);
}

/** Cut a styled line to `cols` columns; colour codes don't count, and the line ends reset. */
export function truncateStyled(s: string, cols: number): string {
  let out = "";
  let w = 0;
  for (const part of s.split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith("\x1b[")) {
      out += part;
      continue;
    }
    for (const g of graphemes(part)) {
      const gw = width(g);
      if (w + gw > cols - 1) return `${out}…\x1b[0m`;
      out += g;
      w += gw;
    }
  }
  return out;
}

/** "3m ago", for presence. */
export { ago };
