import type { WakeHarness } from "@kiwi/core/wake.ts";
import type { Pane } from "../tmux-pane.ts";

const STILL_MS = 700;
const BUSY = /esc to (?:cancel|interrupt|stop)|ctrl\+c to (?:stop|cancel|interrupt)|press esc to|\bworking\.\.\.|\bthinking\.\.\./i;
const ASKING =
  /do you want to|allow (?:once|always|this|for)|\(y\/n\)|\[y\/n\]|yes, allow|approve (?:this|once)|\b1\.\s*yes\b|trust this folder|waiting for (?:your )?(?:approval|confirmation)|↑\/↓ navigate|enter confirm/i;
const AGY_INPUT = /^> ?(.*)$/;
const AGY_HINT = /\(shift\+tab to cycle\)$/;
const DEEPCODE_FOOTER = /^enter send · .+ · ctrl\+d exit$/;
const DEEPCODE_EMPTY = /^>\s+Type your message\.\.\.$/;
const DEEPCODE_RULE = /^─{3,}$/;
const DEEPCODE_STATUS = /^(?:\S )?status: ([a-z_]+)\b/;
const DEEPCODE_ASKING = /^Permission required$|Enter submit\/next|Enter select · Esc interrupt/m;
const DEEPCODE_STATUSES: Readonly<Record<string, "ready" | "busy" | "asking">> = {
  completed: "ready",
  interrupted: "ready",
  failed: "ready",
  permission_denied: "ready",
  pending: "busy",
  processing: "busy",
  ask_permission: "asking",
  waiting_for_user: "asking",
};

export type PromptState = "ready" | "busy" | "asking" | "draft" | "unknown" | "moving" | "gone";

function bottom(screen: string): string[] {
  return screen.trimEnd().split("\n").slice(-12);
}

function agyDraft(lines: readonly string[]): boolean {
  const input = lines.findLast((l) => AGY_INPUT.test(l.trimEnd()));
  const typed = input === undefined ? "" : (AGY_INPUT.exec(input.trimEnd())?.[1] ?? "").trim();
  return typed !== "" && !AGY_HINT.test(typed);
}

function deepcodeState(lines: readonly string[]): Exclude<PromptState, "moving" | "gone"> {
  const rows = lines.map((l) => l.trimEnd());
  if (DEEPCODE_ASKING.test(rows.join("\n"))) return "asking";
  const status = rows.map((l) => DEEPCODE_STATUS.exec(l)?.[1]).findLast((s) => s !== undefined);
  const told = status === undefined ? "ready" : (DEEPCODE_STATUSES[status] ?? "unknown");
  if (told !== "ready") return told;
  const close = rows.length - 2;
  const open = rows.findLastIndex((l, i) => i < close && DEEPCODE_RULE.test(l));
  if (!DEEPCODE_FOOTER.test(rows.at(-1) ?? "") || !DEEPCODE_RULE.test(rows[close] ?? "") || open < 0) return "unknown";
  const input = rows.slice(open + 1, close);
  if (input.length === 1 && DEEPCODE_EMPTY.test(input[0] ?? "")) return "ready";
  return input[0]?.startsWith(">") ? "draft" : "unknown";
}

export function promptState(before: string | null, after: string | null, harness?: WakeHarness): PromptState {
  if (before === null || after === null) return "gone";
  const lines = bottom(after);
  const tail = lines.join("\n");
  if (ASKING.test(tail)) return "asking";
  if (BUSY.test(tail)) return "busy";
  if (harness === "agy" && agyDraft(lines)) return "draft";
  const deepcode = harness === "deepcode" ? deepcodeState(lines) : "ready";
  if (deepcode !== "ready") return deepcode;
  return before === after ? "ready" : "moving";
}

const WHY: Record<Exclude<PromptState, "ready">, string> = {
  busy: "it's in the middle of a turn",
  asking: "it's asking a question on its screen",
  draft: "someone has started typing at its prompt",
  unknown: "its screen isn't an empty prompt Kiwi recognizes",
  moving: "its screen is still changing",
  gone: "its tmux pane is gone",
};

export type Typed = { ok: true } | { ok: false; why: string; retry: boolean };

export async function typeWake(pane: Pane | null, prompt: string, harness?: WakeHarness, stillMs = STILL_MS): Promise<Typed> {
  if (!pane) return { ok: false, why: WHY.gone, retry: false };
  const before = pane.screen();
  await Bun.sleep(stillMs);
  const state = promptState(before, pane.screen(), harness);
  if (state !== "ready") return { ok: false, why: WHY[state], retry: state !== "gone" };
  if (!pane.type(prompt)) return { ok: false, why: "tmux didn't type into its pane", retry: true };
  return pane.enter() ? { ok: true } : { ok: false, why: "tmux didn't press Enter in its pane", retry: true };
}
