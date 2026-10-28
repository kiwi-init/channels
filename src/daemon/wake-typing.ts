import type { HostedTmux } from "./hosted-tmux.ts";

const STILL_MS = 700;
const BUSY = /esc to (?:cancel|interrupt|stop)|ctrl\+c to (?:stop|cancel|interrupt)|press esc to|\bworking\.\.\.|\bthinking\.\.\./i;
const ASKING = /do you want to|allow (?:once|always|this|for)|\(y\/n\)|\[y\/n\]|yes, allow|approve (?:this|once)|\b1\.\s*yes\b|trust this folder|waiting for (?:your )?(?:approval|confirmation)/i;

export type PromptState = "ready" | "busy" | "asking" | "moving" | "gone";

export function promptState(before: string | null, after: string | null): PromptState {
  if (before === null || after === null) return "gone";
  const tail = after.trimEnd().split("\n").slice(-12).join("\n");
  if (ASKING.test(tail)) return "asking";
  if (BUSY.test(tail)) return "busy";
  return before === after ? "ready" : "moving";
}

const WHY: Record<Exclude<PromptState, "ready">, string> = {
  busy: "it's in the middle of a turn",
  asking: "it's asking a question on its screen",
  moving: "its screen is still changing",
  gone: "its window in Channels is gone",
};

const TYPING = "someone is typing in its terminal";

export type Typed = { ok: true } | { ok: false; why: string; retry: boolean };

export async function typeWake(hosted: HostedTmux, pane: string, prompt: string, stillMs = STILL_MS): Promise<Typed> {
  const target = hosted.pane(pane);
  if (!target) return { ok: false, why: WHY.gone, retry: false };
  if (hosted.typing(pane)) return { ok: false, why: TYPING, retry: true };
  const before = target.screen();
  await Bun.sleep(stillMs);
  const state = promptState(before, target.screen());
  if (state !== "ready") return { ok: false, why: WHY[state], retry: state !== "gone" };
  if (!target.type(prompt)) return hosted.typing(pane) ? { ok: false, why: TYPING, retry: true } : { ok: false, why: "tmux didn't type into its window", retry: true };
  return target.enter() ? { ok: true } : { ok: false, why: "tmux didn't press Enter in its window", retry: true };
}
