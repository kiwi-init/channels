import type { StepReply } from "@kiwi/core/protocol.ts";

export const STEP_REPLY_WORDS = { done: "Done", cant: "Can't do it", notNeeded: "Not needed" } as const;

export function stepReplyText(reply: StepReply): string {
  if (reply.outcome === "done") return reply.output ? `${STEP_REPLY_WORDS.done}\n\n${reply.output}` : STEP_REPLY_WORDS.done;
  return `${reply.outcome === "cant" ? STEP_REPLY_WORDS.cant : STEP_REPLY_WORDS.notNeeded}: ${reply.reason}`;
}
