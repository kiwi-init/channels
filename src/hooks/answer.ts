import * as Effect from "effect/Effect";
import { writeSync } from "node:fs";
import type { Relay } from "@kiwi/core/client.ts";
import { openSession, type AgentSession } from "../agent.ts";
import { briefText, COMMANDS } from "../brief.ts";
import { detectWhere } from "../card.ts";
import { loadConfig, type ChannelConfig } from "../config.ts";
import { wakeHooked, wakeOn } from "../daemon/reach.ts";
import { charterLines, formatMessage, holdLine, leadLine, messageHead } from "@kiwi/core/format.ts";
import { kimiServer } from "../kimi-server.ts";
import { here, type Binding, type Here } from "../seats.ts";
import { REENTRY_MAX, reentryText } from "@kiwi/core/reentry.ts";
import { humanOf } from "@kiwi/core/state.ts";
import { asOption, channelOption } from "@kiwi/core/wake.ts";
import { crossing, noteOverLine, nudgeText, openTasksOf, overLine } from "./context-line.ts";
import { commitDelivered, noteHeard } from "./delivered.ts";
import { isRecord } from "./files.ts";
import { liveListeners, refreshListeners } from "./listeners.ts";
import { howMessagesReachYou, startListener, wakeYourself } from "./reach.ts";
import { mcBin, mcFor } from "./self.ts";

const MAX_CONTEXT = 6_000;

export function stopStyle(input: { hook_event_name?: string; status?: string; loop_count?: number }): "cursor" | "gemini" | "block" {
  if (input.hook_event_name === "AfterAgent") return "gemini";
  if (input.hook_event_name === "Stop") return "block";
  if (input.status != null || typeof input.loop_count === "number") return "cursor";
  return "block";
}

export function cursorStopFollowup(mc: string, unread: boolean, max = Number.POSITIVE_INFINITY): string | null {
  if (!unread) return null;
  const full = `Unread Kiwi messages. Run \`${mc} read\`, answer with \`${mc} reply N "…"\`, then continue.`;
  if (full.length <= max) return full;
  const short = `Unread Kiwi messages: \`${mc} read\`.`;
  return short.length <= max ? short : null;
}

export interface HookInput {
  session_id?: string;
  source?: string;
  cwd?: string;
  stop_hook_active?: boolean;
  hook_event_name?: string;
  hookEventName?: string;
  status?: string;
  loop_count?: number;
  composer_mode?: string;
  is_background_agent?: boolean;
  reason?: string;
  backgroundTasks?: unknown;
  model?: unknown;
  conversation_id?: unknown;
  cursor_version?: unknown;
  transcript_path?: unknown;
  landed?: unknown;
}

export function freshAt(input: Pick<HookInput, "source">, now: number): number | null {
  return input.source === "resume" ? null : now;
}

export interface BackgroundTask {
  type: string;
  text: string;
}

export function backgroundTasks(raw: unknown): BackgroundTask[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((t) => {
    if (!isRecord(t)) return [];
    const type = typeof t.type === "string" ? t.type : typeof t.kind === "string" ? t.kind : null;
    return type === null ? [] : [{ type, text: [t.command, t.description].filter((x) => typeof x === "string").join("\n") }];
  });
}

export function grokMonitorListens(tasks: readonly BackgroundTask[], commands: readonly string[]): boolean {
  return tasks.some((t) => t.type === "monitor" && t.text.split("\n").some((line) => commands.includes(line.trim())));
}

const LISTENER_SETTLE_MS = 1_500;

type ListenCheck = { kind: "skip" } | { kind: "check"; listens: () => boolean; settles: boolean };

function listenCheck(input: HookInput, b: Binding, who: Here, mc: string): ListenCheck {
  if (who.harness === "kimi" || who.harness === "cursor") {
    if (who.harness === "kimi" && kimiServer(who.pid)) return { kind: "skip" };
    const heard = () => liveListeners().some((l) => l.alias === b.alias && l.as === b.as && ((!!who.session && l.session === who.session) || (!!who.pid && l.pid === who.pid)));
    return { kind: "check", listens: heard, settles: true };
  }
  if (who.harness !== "grok" || input.stop_hook_active) return { kind: "skip" };
  const tasks = backgroundTasks(input.backgroundTasks);
  if (!tasks) return { kind: "skip" };
  const commands = [COMMANDS.listen(mc), COMMANDS.listen(`${mcBin()} ${channelOption(b.alias)} ${asOption(b.as)}`)];
  return { kind: "check", listens: () => grokMonitorListens(tasks, commands), settles: false };
}

export interface Reminder {
  full: string;
  short: string;
}

const rearmText = Effect.fn("Hooks.rearmText")(function* (input: HookInput, b: Binding, who: Here, mc: string) {
  const how = wakeYourself(mc, who.harness);
  const start = startListener(mc, who.harness);
  if (!how || !start || !wakeOn(loadConfig(), b.alias, b.as)) return null;
  const check = listenCheck(input, b, who, mc);
  if (check.kind === "skip" || check.listens()) return null;
  if (check.settles) {
    yield* Effect.sleep(LISTENER_SETTLE_MS);
    yield* Effect.promise(() => refreshListeners());
    if (check.listens()) return null;
  }
  const subagent = who.harness === "kimi" ? " If you are a subagent, ignore this and end your turn." : "";
  const reminder: Reminder = {
    full: `Before you end this turn: no Kiwi listener of yours is running for ${b.alias}, so nothing would wake you when a message for you arrives.${subagent}\n${how}`,
    short: `Before you end this turn: no Kiwi listener of yours is running for ${b.alias}.${subagent} ${start}`,
  };
  return reminder;
});

export function fitReminder(r: Reminder | null, budget: number): string | null {
  if (!r) return null;
  if (r.full.length <= budget) return r.full;
  if (r.short.length <= budget) return r.short;
  return budget > 2 ? `${r.short.slice(0, budget - 2)} …` : null;
}

export function stopUnreadMax(head: string, reminder: string | null, budget: number): number {
  return Math.max(0, Math.min(MAX_CONTEXT, budget - head.length - 1 - (reminder ? reminder.length + 2 : 0)));
}

export function cursorFollow(mc: string, unread: boolean, reminder: Reminder | null, budget: number): string {
  const nudge = cursorStopFollowup(mc, unread, budget);
  const rearm = fitReminder(reminder, budget - (nudge ? nudge.length + 2 : 0));
  return [nudge, rearm].filter((t) => t !== null).join("\n\n");
}

const contextNudge = Effect.fn("Hooks.contextNudge")(function* (input: HookInput, s: AgentSession, who: Here, mc: string, budget: number) {
  const session = who.session;
  const file = input.transcript_path;
  if (who.harness !== "claude" || !session || typeof file !== "string" || !file) return null;
  const { claudeContext } = yield* Effect.promise(() => import("../harness.ts"));
  const context = yield* Effect.sync(() => {
    try {
      return claudeContext(file);
    } catch {
      // A transcript that can't be read says nothing about the context: no nudge, the line's state kept.
      return undefined;
    }
  });
  const over = overLine(s.alias, s.me, session);
  const next = crossing(context?.used, over);
  if (!next.over && over) noteOverLine(s.alias, s.me, session, false);
  if (!next.nudge || !context || input.stop_hook_active) return null;
  const { state } = yield* s.state();
  const text = nudgeText(context, openTasksOf(state, s.me), mc);
  if (!text || text.length > budget) return null;
  return { text, shown: Effect.sync(() => noteOverLine(s.alias, s.me, session, true)) };
});

export function stopReason(head: string, unread: string, reminder: string | null): string {
  return [unread ? `${head}\n${unread}` : null, reminder].filter((t) => t !== null).join("\n\n");
}

export function fitting(lines: readonly string[], max = MAX_CONTEXT): { count: number; text: string } {
  let count = 0;
  let size = 0;
  for (const line of lines) {
    const next = size + (count ? 1 : 0) + line.length;
    if (next > max) break;
    size = next;
    count += 1;
  }
  const first = lines[0];
  if (!count && first !== undefined) return { count: 1, text: `${first.slice(0, max)} …` };
  return { count, text: lines.slice(0, count).join("\n") };
}

function moreNote(rest: number, mc: string): string {
  return `… ${rest} more unread: they come next, or run \`${mc} read\``;
}

export const CLIP_MIN = 1_000;

function whole(lines: readonly string[], max: number): number {
  let count = 0;
  let size = 0;
  for (const line of lines) {
    const next = size + (count ? 1 : 0) + line.length;
    if (next > max) break;
    size = next;
    count += 1;
  }
  return count;
}

export interface Unread {
  line: string;
  seq: number;
  head: number;
}

export function handOver(unread: readonly Unread[], max: number, mc: string): { count: number; text: string } {
  const total = unread.length;
  const lines = unread.map((u) => u.line);
  const first = unread[0];
  if (first === undefined) return { count: 0, text: "" };
  if (whole(lines, max) === total) return { count: total, text: lines.join("\n") };
  const count = whole(lines, max - 1 - moreNote(total, mc).length);
  if (count > 0) return { count, text: [...lines.slice(0, count), moreNote(total - count, mc)].join("\n") };
  const cut = `(#${first.seq} is cut here: ${mc} show ${first.seq} has all of it)`;
  const after = total > 1 ? [moreNote(total - 1, mc)] : [];
  const room = max - 2 - 1 - cut.length - after.reduce((n, a) => n + 1 + a.length, 0);
  if (room >= first.head + CLIP_MIN) return { count: 1, text: [`${first.line.slice(0, room)} …`, cut, ...after].join("\n") };
  const waiting = moreNote(total, mc);
  return { count: 0, text: waiting.length <= max ? waiting : "" };
}

const unreadText = Effect.fn("Hooks.unreadText")(function* (s: AgentSession, mc: string, max = MAX_CONTEXT) {
  const { messages, state, commit } = yield* s.unread();
  const hand = handOver(
    messages.map((m) => ({
      line: formatMessage(m, state.trust.get(m.seq), state, s.me),
      seq: m.seq,
      head: messageHead(m, state.trust.get(m.seq), state, s.me).length + 2,
    })),
    max,
    mc,
  );
  const shownMessages = messages.slice(0, hand.count);
  const rest = messages.length - hand.count;
  const last = shownMessages.at(-1);
  const shown = Effect.andThen(
    !rest ? commit() : last ? commit(last.seq) : Effect.void,
    Effect.sync(() =>
      noteHeard(
        here().session,
        s.alias,
        s.me,
        shownMessages.map((m) => m.seq),
      ),
    ),
  );
  return { text: hand.text, shown };
});

type AnswerKind = "cursor-start" | "start" | "gemini-prompt" | "prompt" | "followup" | "block" | "deny";

export interface Answer {
  kind: AnswerKind;
  text: string;
  shown: Effect.Effect<void, never, Relay>;
}

function envelope(kind: AnswerKind, texts: readonly string[]): string {
  switch (kind) {
    case "cursor-start":
      return JSON.stringify({ additional_context: texts.join("\n\n") });
    case "start":
      return JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: texts.join("\n\n") } });
    case "gemini-prompt":
      return JSON.stringify({ hookSpecificOutput: { hookEventName: "BeforeAgent", additionalContext: texts.join("\n\n") } });
    case "prompt":
      return texts.join("\n\n");
    case "followup":
      return JSON.stringify({ followup_message: texts.join(" ") });
    case "block":
    case "deny":
      return JSON.stringify({ decision: kind, reason: texts.join("\n\n") });
  }
}

function answered(kind: AnswerKind, text: string, shown: Effect.Effect<void, never, Relay> = Effect.void): Answer {
  return { kind, text, shown };
}

export function kimiReason(answers: readonly Pick<Answer, "kind" | "text">[]): string {
  return answers.map((a) => a.text).join("\n\n");
}

export function tellKimi(reason: string): number {
  try {
    writeSync(2, `${reason}\n`);
    return 2;
  } catch {
    return 0;
  }
}

export function printed<A extends Pick<Answer, "kind">>(answers: readonly A[]): A[] {
  const [first] = answers;
  return first ? answers.filter((a) => a.kind === first.kind) : [];
}

export function hookOutput(answers: readonly Pick<Answer, "kind" | "text">[]): string | null {
  const [first] = answers;
  if (!first) return null;
  return envelope(
    first.kind,
    printed(answers).map((a) => a.text),
  );
}

export const HOOK_CONTEXT_MAX = 9_500;
const UNREAD_FLOOR = 1_500;
const REENTRY_MIN = 200;
const UNREAD_HEAD = "Unread messages for you:";

export function seatBudget(seats: number): number {
  return Math.floor(HOOK_CONTEXT_MAX / Math.max(1, seats)) - 2;
}

export function startContext(brief: string, reentry: string | null, unread: string): string {
  return [brief, ...(reentry ? ["", reentry] : []), ...(unread ? ["", UNREAD_HEAD, unread] : [])].join("\n");
}

export function startBudgets(budget: number, brief: number): { reentry: number; unread: (reentry: number) => number } {
  const room = budget - brief;
  const reentry = Math.min(REENTRY_MAX, room - UNREAD_FLOOR - 2);
  return {
    reentry: reentry >= REENTRY_MIN ? reentry : 0,
    unread: (used) => Math.max(0, Math.min(MAX_CONTEXT, room - (used ? used + 2 : 0) - UNREAD_HEAD.length - 3)),
  };
}

function promptHead(alias: string): string {
  return `New Kiwi Channels messages for you (${alias}):`;
}

export const answer = Effect.fn("Hooks.answer")(function* (event: string, input: HookInput, b: Binding, cfg: ChannelConfig, who: Here, budget = HOOK_CONTEXT_MAX) {
  if (who.harness === "grok" && (event === "session-start" || event === "prompt")) return null;
  const mc = mcFor(b.alias, b.as, input.cwd ?? process.cwd(), who);
  const s = yield* openSession(b.alias, cfg, b.as);
  if (who.session) yield* commitDelivered(s, who.session, who.pid);
  if (event === "prompt" || event === "stop") yield* Effect.ignoreCause(s.refreshWhere(detectWhere(input.cwd ?? process.cwd())));

  if (event === "session-start") {
    const fresh = freshAt(input, Date.now());
    if (fresh !== null) yield* Effect.ignoreCause(s.markFresh(detectWhere(input.cwd ?? process.cwd()), fresh));
    const { state } = yield* s.state();
    const seat = state.members.get(b.as);
    const local = loadConfig();
    const listen = howMessagesReachYou(mc, wakeOn(local, b.alias, b.as), who, wakeHooked(local, b.alias, b.as));
    const brief = briefText({
      alias: b.alias,
      agent: b.as,
      mc,
      listen,
      human: humanOf(state, b.as),
      hold: holdLine(state),
      charter: charterLines(state),
      lead: leadLine(state, b.as),
      scopes: seat?.scopes,
      ...(seat?.persona ? { persona: seat.persona } : {}),
    });
    const budgets = startBudgets(budget, brief.length);
    const reentry = fresh === null || budgets.reentry === 0 ? null : reentryText(state, b.as, Date.now(), budgets.reentry, mc);
    const unreadMax = budgets.unread(reentry?.length ?? 0);
    const unread = unreadMax > 0 ? yield* unreadText(s, mc, unreadMax) : { text: "", shown: Effect.void };
    const additionalContext = startContext(brief, reentry, unread.text);
    if (input.hook_event_name === "sessionStart" || input.composer_mode != null || typeof input.is_background_agent === "boolean") {
      return answered("cursor-start", additionalContext, unread.shown);
    }
    return answered("start", additionalContext, unread.shown);
  }

  if (event === "prompt") {
    const head = promptHead(b.alias);
    const unread = yield* unreadText(s, mc, Math.min(MAX_CONTEXT, budget - head.length - 1));
    if (!unread.text) return yield* Effect.as(unread.shown, null);
    const text = [head, unread.text].join("\n");
    if (input.hook_event_name === "BeforeAgent") return answered("gemini-prompt", text, unread.shown);
    return answered("prompt", text, unread.shown);
  }

  if (event === "stop") {
    const style = stopStyle(input);
    if (style === "cursor") {
      if (input.status && input.status !== "completed") return null;
      const { messages, state } = yield* s.state();
      const unread = (yield* s.unreadCount(state, messages)) > 0;
      const follow = cursorFollow(mc, unread, yield* rearmText(input, b, who, mc), budget);
      return follow ? answered("followup", follow) : null;
    }
    if (who.harness === "grok" && input.reason !== undefined && input.reason !== "end_turn") return null;
    const stopHead = `Before stopping: unread Kiwi Channels messages for you (${b.alias}). Handle them (answer with \`${mc} reply N "…"\`):`;
    const nudge = yield* contextNudge(input, s, who, mc, budget);
    const rearm = fitReminder(yield* rearmText(input, b, who, mc), budget - (nudge ? nudge.text.length + 2 : 0));
    const reminder = [nudge?.text ?? null, rearm].filter((t) => t !== null).join("\n\n") || null;
    const unreadMax = stopUnreadMax(stopHead, reminder, budget);
    const unread = unreadMax > 0 ? yield* unreadText(s, mc, unreadMax) : { text: "", shown: Effect.void };
    const decision = style === "gemini" ? "deny" : "block";
    const reason = stopReason(stopHead, unread.text, reminder);
    const shown = nudge ? Effect.andThen(nudge.shown, unread.shown) : unread.shown;
    if (reason) return answered(decision, reason, shown);
    yield* unread.shown;
  }
  return null;
});
