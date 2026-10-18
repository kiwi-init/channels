import * as Effect from "effect/Effect";
import { writeSync } from "node:fs";
import { openSession, type AgentSession } from "../agent.ts";
import { briefText, COMMANDS } from "../brief.ts";
import { loadConfig, type ChannelConfig } from "../config.ts";
import { wakeOn } from "../daemon/reach.ts";
import { charterLines, formatMessage, holdLine, leadLine } from "@kiwi/core/format.ts";
import type { Binding, Here } from "../seats.ts";
import { humanOf } from "@kiwi/core/state.ts";
import { asOption, channelOption } from "@kiwi/core/wake.ts";
import { commitDelivered } from "./delivered.ts";
import { isRecord } from "./files.ts";
import { liveListeners, refreshListeners } from "./listeners.ts";
import { howMessagesReachYou, wakeYourself } from "./reach.ts";
import { mcBin, mcFor } from "./self.ts";

export const MAX_CONTEXT = 6_000;

export function stopStyle(input: { hook_event_name?: string; status?: string; loop_count?: number }): "cursor" | "gemini" | "block" {
  if (input.hook_event_name === "AfterAgent") return "gemini";
  if (input.hook_event_name === "Stop") return "block";
  if (input.status != null || typeof input.loop_count === "number") return "cursor";
  return "block";
}

export function cursorStopFollowup(mc: string, unread: boolean): string | null {
  if (unread) return `Unread Kiwi messages. Run \`${mc} read\`, answer with \`${mc} reply N "…"\`, then continue.`;
  return null;
}

export interface HookInput {
  session_id?: string;
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
  if (who.harness === "kimi") {
    const heard = () => liveListeners().some((l) => l.alias === b.alias && l.as === b.as && ((!!who.session && l.session === who.session) || (!!who.pid && l.pid === who.pid)));
    return { kind: "check", listens: heard, settles: true };
  }
  if (who.harness !== "grok" || input.stop_hook_active) return { kind: "skip" };
  const tasks = backgroundTasks(input.backgroundTasks);
  if (!tasks) return { kind: "skip" };
  const commands = [COMMANDS.listen(mc), COMMANDS.listen(`${mcBin()} ${channelOption(b.alias)} ${asOption(b.as)}`)];
  return { kind: "check", listens: () => grokMonitorListens(tasks, commands), settles: false };
}

const rearmText = Effect.fn("Hooks.rearmText")(function* (input: HookInput, b: Binding, who: Here, mc: string) {
  const how = wakeYourself(mc, who.harness);
  if (!how || !wakeOn(loadConfig(), b.alias, b.as)) return null;
  const check = listenCheck(input, b, who, mc);
  if (check.kind === "skip" || check.listens()) return null;
  if (check.settles) {
    yield* Effect.sleep(LISTENER_SETTLE_MS);
    yield* Effect.promise(() => refreshListeners());
    if (check.listens()) return null;
  }
  const subagent = who.harness === "kimi" ? " If you are a subagent, ignore this and end your turn." : "";
  return `Before you end this turn: no Kiwi listener of yours is running for ${b.alias}, so nothing would wake you when a message for you arrives.${subagent}\n${how}`;
});

const unreadText = Effect.fn("Hooks.unreadText")(function* (s: AgentSession) {
  const { messages, state } = yield* s.read();
  const text = messages.map((m) => formatMessage(m, state.trust.get(m.seq), state, s.me)).join("\n");
  return text.length > MAX_CONTEXT ? `${text.slice(0, MAX_CONTEXT)}\n… (more: run \`kiwi log\`)` : text;
});

type AnswerKind = "cursor-start" | "start" | "gemini-prompt" | "prompt" | "followup" | "block" | "deny";

interface Answer {
  kind: AnswerKind;
  text: string;
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

function answered(kind: AnswerKind, text: string): Answer {
  return { kind, text };
}

export function kimiReason(answers: readonly Answer[]): string {
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

export function hookOutput(answers: readonly Answer[]): string | null {
  const [first] = answers;
  if (!first) return null;
  return envelope(
    first.kind,
    answers.filter((a) => a.kind === first.kind).map((a) => a.text),
  );
}

export const answer = Effect.fn("Hooks.answer")(function* (event: string, input: HookInput, b: Binding, cfg: ChannelConfig, who: Here) {
  if (who.harness === "grok" && (event === "session-start" || event === "prompt")) return null;
  const mc = mcFor(b.alias, b.as, input.cwd ?? process.cwd(), who);
  const s = yield* openSession(b.alias, cfg, b.as);
  if (who.session) yield* commitDelivered(s, who.session);

  if (event === "session-start") {
    const { state } = yield* s.state();
    const seat = state.members.get(b.as);
    const listen = howMessagesReachYou(mc, wakeOn(loadConfig(), b.alias, b.as), who);
    const lines = [
      briefText({
        alias: b.alias,
        agent: b.as,
        mc,
        listen,
        human: humanOf(state, b.as),
        hold: holdLine(state),
        charter: charterLines(state),
        lead: leadLine(state, b.as),
        role: seat?.role,
        about: seat?.about,
        scopes: seat?.scopes,
      }),
    ];
    const unread = yield* unreadText(s);
    if (unread) lines.push("", "Unread messages for you:", unread);
    const additionalContext = lines.join("\n");
    if (input.hook_event_name === "sessionStart" || input.composer_mode != null || typeof input.is_background_agent === "boolean") {
      return answered("cursor-start", additionalContext);
    }
    return answered("start", additionalContext);
  }

  if (event === "prompt") {
    const unread = yield* unreadText(s);
    const lines: string[] = [];
    if (unread) lines.push(`New Kiwi Channels messages for you (${b.alias}):`, unread);
    if (!lines.length) return null;
    const text = lines.join("\n");
    if (input.hook_event_name === "BeforeAgent") return answered("gemini-prompt", text);
    return answered("prompt", text);
  }

  if (event === "stop") {
    const style = stopStyle(input);
    if (style === "cursor") {
      if (input.status && input.status !== "completed") return null;
      const { messages, state } = yield* s.state();
      const unread = (yield* s.unreadCount(state, messages)) > 0;
      const follow = cursorStopFollowup(mc, unread);
      if (!follow) return null;
      return answered("followup", follow);
    }
    if (who.harness === "grok" && input.reason !== undefined && input.reason !== "end_turn") return null;
    const unread = yield* unreadText(s);
    const decision = style === "gemini" ? "deny" : "block";
    const handOver = unread ? `Before stopping: unread Kiwi Channels messages for you. Handle them (answer with \`${mc} reply N "…"\`):\n${unread}` : null;
    const rearm = yield* rearmText(input, b, who, mc);
    const reason = [handOver, rearm].filter((t) => t !== null).join("\n\n");
    if (reason) return answered(decision, reason);
  }
  return null;
});
