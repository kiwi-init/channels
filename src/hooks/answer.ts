import * as Effect from "effect/Effect";
import { writeSync } from "node:fs";
import { join } from "node:path";
import type { Relay } from "@kiwi/core/client.ts";
import { openSession, type AgentSession } from "../agent.ts";
import type { Delivery } from "../agent/shared.ts";
import { briefText, COMMANDS } from "../brief.ts";
import { detectWhere } from "../card.ts";
import { home, loadConfig, type ChannelConfig } from "../config.ts";
import { wakeHooked, wakeOn } from "../daemon/reach.ts";
import { appendRotated } from "../daemon/wake.ts";
import { charterLines, formatMessage, holdLine, leadLine, messageHead } from "@kiwi/core/format.ts";
import { kimiServer } from "../kimi-server.ts";
import { here, type Binding, type Here } from "../seats.ts";
import { REENTRY_MAX, reentryText } from "@kiwi/core/reentry.ts";
import { humanOf } from "@kiwi/core/state.ts";
import { asOption, channelOption } from "@kiwi/core/wake.ts";
import { crossing, noteOverLine, nudgeShort, nudgeText, openTasksOf, overLine } from "./context-line.ts";
import { commitDelivered, noteHeard } from "./delivered.ts";
import { isRecord } from "./files.ts";
import { loopDelivery } from "./loop-wait.ts";
import { liveListeners, refreshListeners } from "./listeners.ts";
import { notePersonaTold, personaChange, personaMark, personaTold } from "./persona-line.ts";
import { howMessagesReachYou, startListener, wakeYourself } from "./reach.ts";
import { mcBin, mcFor } from "./self.ts";

const MAX_CONTEXT = 6_000;

export function stopStyle(input: { hook_event_name?: string; status?: string; loop_count?: number }): "cursor" | "gemini" | "block" {
  if (input.hook_event_name === "AfterAgent") return "gemini";
  if (input.hook_event_name === "Stop") return "block";
  if (input.status != null || typeof input.loop_count === "number") return "cursor";
  return "block";
}

export function cursorStopFollowup(alias: string, mc: string, unread: boolean, max = Number.POSITIVE_INFINITY): string | null {
  if (!unread) return null;
  const full = `Unread Kiwi messages (${alias}). Run \`${mc} read\`, answer with \`${mc} reply N "…"\`, then continue.`;
  if (full.length <= max) return full;
  const short = `Unread Kiwi messages (${alias}): \`${mc} read\`.`;
  if (short.length <= max) return short;
  const bare = `Unread Kiwi messages: \`${mc} read\`.`;
  return bare.length <= max ? bare : null;
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
  refused?: unknown;
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
    const text = [t.command, t.description, t.displayCommand, t.display_command].filter((x) => typeof x === "string").join("\n");
    return type === null ? [] : [{ type, text }];
  });
}

const TAGGED = /^\[[^\]\n]{1,32}\]\s*/;

export function grokMonitorListens(tasks: readonly BackgroundTask[], commands: readonly string[]): boolean {
  return tasks.some((t) => t.type === "monitor" && t.text.split("\n").some((line) => commands.includes(line.trim().replace(TAGGED, ""))));
}

const LOGGED_CHARS = 300;

function noteGrok(b: Binding, text: string): void {
  try {
    appendRotated(join(home(), "stop.log"), `${new Date().toISOString()}\t${b.alias}\t${b.as}\tgrok: ${text}\n`);
  } catch {
    // A home Kiwi can't write to keeps no stop log; the reminder still goes to the agent.
  }
}

function noteUnheard(b: Binding, tasks: readonly BackgroundTask[], commands: readonly string[]): void {
  const monitors = tasks.filter((t) => t.type === "monitor").map((t) => JSON.stringify(t.text.slice(0, LOGGED_CHARS)));
  noteGrok(b, `no listener among ${monitors.length} monitors\t${monitors.join(" ")}\twanted ${JSON.stringify(commands)}`);
}

const LISTENER_SETTLE_MS = 1_500;

type ListenCheck = { kind: "skip" } | { kind: "check"; listens: () => boolean; settles: boolean };

function listenCheck(input: HookInput, b: Binding, who: Here, mc: string): ListenCheck {
  if (who.harness === "kimi" || who.harness === "cursor" || who.harness === "zcode") {
    if (who.harness === "kimi" && kimiServer(who.pid)) return { kind: "skip" };
    const heard = () => liveListeners().some((l) => l.alias === b.alias && l.as === b.as && ((!!who.session && l.session === who.session) || (!!who.pid && l.pid === who.pid)));
    return { kind: "check", listens: heard, settles: true };
  }
  if (who.harness !== "grok") return { kind: "skip" };
  if (input.stop_hook_active) {
    noteGrok(b, "listener check skipped: stop_hook_active");
    return { kind: "skip" };
  }
  const tasks = backgroundTasks(input.backgroundTasks);
  if (!tasks) {
    const listens = () => {
      const heard = liveListeners().some((l) => l.alias === b.alias && l.as === b.as);
      if (!heard) noteGrok(b, "no backgroundTasks; no live listener");
      return heard;
    };
    return { kind: "check", listens, settles: false };
  }
  const commands = [COMMANDS.listen(mc), COMMANDS.listen(`${mcBin()} ${channelOption(b.alias)} ${asOption(b.as)}`)];
  const listens = () => {
    const heard = grokMonitorListens(tasks, commands);
    if (!heard) noteUnheard(b, tasks, commands);
    return heard;
  };
  return { kind: "check", listens, settles: false };
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

export function cursorFollow(alias: string, mc: string, unread: boolean, reminder: Reminder | null, budget: number): string {
  const nudge = cursorStopFollowup(alias, mc, unread, budget);
  const rearm = fitReminder(reminder, budget - (nudge ? nudge.length + 2 : 0));
  return [nudge, rearm].filter((t) => t !== null).join("\n\n");
}

const contextNudge = Effect.fn("Hooks.contextNudge")(function* (input: HookInput, s: AgentSession, who: Here, mc: string, budget: number) {
  if (loadConfig().contextLine !== "on") return null;
  const session = who.session;
  const file = input.transcript_path;
  if ((who.harness !== "claude" && who.harness !== "codex") || !session || typeof file !== "string" || !file) return null;
  const { claudeContext, codexContext } = yield* Effect.promise(() => import("../harness.ts"));
  const read = who.harness === "codex" ? codexContext : claudeContext;
  const context = yield* Effect.sync(() => {
    try {
      return read(file);
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
  const tasks = openTasksOf(state, s.me);
  const lead = state.lead === s.me;
  const text = [nudgeText(context, tasks, mc, lead), nudgeShort(tasks, mc, lead)].find((t) => t !== null && t.length <= budget);
  if (!text) return null;
  return { text, shown: Effect.sync(() => noteOverLine(s.alias, s.me, session, true, state.head)) };
});

const personaNews = Effect.fn("Hooks.personaNews")(function* (s: AgentSession, who: Here, mc: string, max: number) {
  const session = who.session;
  if (!session) return null;
  const { state } = yield* s.state();
  const now = state.members.get(s.me)?.persona;
  const text = personaChange(personaTold(s.alias, s.me, session), now, mc, max);
  if (!text) return null;
  const mark = personaMark(now);
  return { text, shown: Effect.sync(() => notePersonaTold(s.alias, s.me, session, mark)) };
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
  const cut = `(#${first.seq} is cut here: ${mc} show ${first.seq} --raw has all of it)`;
  const after = total > 1 ? [moreNote(total - 1, mc)] : [];
  const room = max - 2 - 1 - cut.length - after.reduce((n, a) => n + 1 + a.length, 0);
  if (room >= first.head + CLIP_MIN) return { count: 1, text: [`${first.line.slice(0, room)} …`, cut, ...after].join("\n") };
  const waiting = moreNote(total, mc);
  return { count: 0, text: waiting.length <= max ? waiting : "" };
}

const unreadText = Effect.fn("Hooks.unreadText")(function* (s: AgentSession, mc: string, max = MAX_CONTEXT, d: Delivery = {}) {
  const { messages, state, commit } = yield* s.unread(d);
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
function unreadHead(alias: string): string {
  return `Unread messages for you (${alias}):`;
}

export function seatBudget(seats: number): number {
  return Math.floor(HOOK_CONTEXT_MAX / Math.max(1, seats)) - 2;
}

export function startContext(alias: string, brief: string, reentry: string | null, unread: string): string {
  return [brief, ...(reentry ? ["", reentry] : []), ...(unread ? ["", unreadHead(alias), unread] : [])].join("\n");
}

export function startBudgets(alias: string, budget: number, brief: number): { reentry: number; unread: (reentry: number) => number } {
  const room = budget - brief;
  const reentry = Math.min(REENTRY_MAX, room - UNREAD_FLOOR - 2);
  return {
    reentry: reentry >= REENTRY_MIN ? reentry : 0,
    unread: (used) => Math.max(0, Math.min(MAX_CONTEXT, room - (used ? used + 2 : 0) - unreadHead(alias).length - 3)),
  };
}

function promptHead(alias: string): string {
  return `New Kiwi Channels messages for you (${alias}):`;
}

export const answer = Effect.fn("Hooks.answer")(function* (event: string, input: HookInput, b: Binding, cfg: ChannelConfig, who: Here, budget = HOOK_CONTEXT_MAX) {
  if (who.harness === "grok" && (event === "session-start" || event === "prompt")) return null;
  const mc = mcFor(b.alias, b.as, input.cwd ?? process.cwd(), who);
  const s = yield* openSession(b.alias, cfg, b.as);
  if (who.session) yield* commitDelivered(s, who.session, who.harness === "claude" ? who.pid : undefined);
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
      privateRooms: [...state.rooms.values()].flatMap((r) => (r.members ? [r.name] : [])),
      charter: charterLines(state),
      lead: leadLine(state, b.as),
      scopes: seat?.scopes,
      ...(seat?.persona ? { persona: seat.persona } : {}),
      contextLine: local.contextLine === "on",
    });
    const budgets = startBudgets(b.alias, budget, brief.length);
    const reentry = fresh === null || budgets.reentry === 0 ? null : reentryText(state, b.as, Date.now(), budgets.reentry, mc);
    const unreadMax = budgets.unread(reentry?.length ?? 0);
    const unread = unreadMax > 0 ? yield* unreadText(s, mc, unreadMax) : { text: "", shown: Effect.void };
    const additionalContext = startContext(b.alias, brief, reentry, unread.text);
    const session = who.session;
    const shown = session
      ? Effect.andThen(
          Effect.sync(() => notePersonaTold(b.alias, b.as, session, personaMark(seat?.persona))),
          unread.shown,
        )
      : unread.shown;
    if (input.hook_event_name === "sessionStart" || input.composer_mode != null || typeof input.is_background_agent === "boolean") {
      return answered("cursor-start", additionalContext, shown);
    }
    return answered("start", additionalContext, shown);
  }

  if (event === "prompt") {
    const head = promptHead(b.alias);
    const persona = yield* personaNews(s, who, mc, Math.min(MAX_CONTEXT, budget));
    const unread = yield* unreadText(s, mc, Math.max(0, Math.min(MAX_CONTEXT, budget - head.length - 1 - (persona ? persona.text.length + 2 : 0))), loopDelivery());
    if (!unread.text && !persona) return yield* Effect.as(unread.shown, null);
    const text = [persona?.text ?? null, unread.text ? [head, unread.text].join("\n") : null].filter((t) => t !== null).join("\n\n");
    const shown = persona ? Effect.andThen(persona.shown, unread.shown) : unread.shown;
    if (input.hook_event_name === "BeforeAgent") return answered("gemini-prompt", text, shown);
    return answered("prompt", text, shown);
  }

  if (event === "stop") {
    const style = stopStyle(input);
    if (style === "cursor") {
      if (input.status && input.status !== "completed") return null;
      const { messages, state } = yield* s.state();
      const unread = (yield* s.unreadAt(state, messages, loopDelivery())).unread > 0;
      const follow = cursorFollow(b.alias, mc, unread, yield* rearmText(input, b, who, mc), budget);
      return follow ? answered("followup", follow) : null;
    }
    if (who.harness === "grok" && input.reason !== undefined && input.reason !== "end_turn") return null;
    const stopHead = `Before stopping: unread Kiwi Channels messages for you (${b.alias}). Handle them (answer with \`${mc} reply N "…"\`):`;
    const nudge = yield* contextNudge(input, s, who, mc, budget);
    const persona = yield* personaNews(s, who, mc, budget - (nudge ? nudge.text.length + 2 : 0));
    const rearm = fitReminder(yield* rearmText(input, b, who, mc), budget - (nudge ? nudge.text.length + 2 : 0) - (persona ? persona.text.length + 2 : 0));
    const reminder = [nudge?.text ?? null, rearm].filter((t) => t !== null).join("\n\n") || null;
    const unreadMax = stopUnreadMax(stopHead, [persona?.text ?? null, reminder].filter((t) => t !== null).join("\n\n") || null, budget);
    const unread = unreadMax > 0 ? yield* unreadText(s, mc, unreadMax, loopDelivery()) : { text: "", shown: Effect.void };
    const decision = style === "gemini" ? "deny" : "block";
    const reason = [persona?.text ?? null, stopReason(stopHead, unread.text, reminder) || null].filter((t) => t !== null).join("\n\n");
    const told = persona ? Effect.andThen(persona.shown, unread.shown) : unread.shown;
    const shown = nudge ? Effect.andThen(nudge.shown, told) : told;
    if (reason) return answered(decision, reason, shown);
    yield* unread.shown;
  }
  return null;
});
