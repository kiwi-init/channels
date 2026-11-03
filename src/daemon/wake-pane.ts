import type { WakeHarness } from "@kiwi/core/wake.ts";
import type { Pane } from "../terminals/plugin.ts";

const STILL_MS = 700;
const BUSY = /esc to (?:cancel|interrupt|stop)|ctrl\+c to (?:stop|cancel|interrupt)|press esc to|\bworking\.\.\.|\bthinking\.\.\./i;
const ASKING =
  /do you want to|allow (?:once|always|this|for)|\(y\/n\)|\[y\/n\]|yes, allow|approve (?:this|once)|\b1\.\s*yes\b|trust this folder|waiting for (?:your )?(?:approval|confirmation)|↑\/↓ navigate|enter confirm/i;
const AGY_INPUT = /^> ?(.*)$/;
const AGY_HINT = /\(shift\+tab to cycle\)$/;

export type PromptState = "ready" | "busy" | "asking" | "draft" | "moving" | "gone";

function bottom(screen: string): string[] {
  return screen.trimEnd().split("\n").slice(-12);
}

function agyDraft(lines: readonly string[]): boolean {
  const input = lines.findLast((l) => AGY_INPUT.test(l.trimEnd()));
  const typed = input === undefined ? "" : (AGY_INPUT.exec(input.trimEnd())?.[1] ?? "").trim();
  return typed !== "" && !AGY_HINT.test(typed);
}

export function promptState(before: string | null, after: string | null, harness?: WakeHarness): PromptState {
  if (before === null || after === null) return "gone";
  const lines = bottom(after);
  const tail = lines.join("\n");
  if (ASKING.test(tail)) return "asking";
  if (BUSY.test(tail)) return "busy";
  if (harness === "agy" && agyDraft(lines)) return "draft";
  return before === after ? "ready" : "moving";
}

const WHY: Record<Exclude<PromptState, "ready">, string> = {
  busy: "it's in the middle of a turn",
  asking: "it's asking a question on its screen",
  draft: "someone has started typing at its prompt",
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
