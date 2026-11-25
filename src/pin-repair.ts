import { fromB64url } from "@kiwi/core/crypto.ts";
import type { PinCheck } from "@kiwi/core/pin.ts";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export const REPAIR_BUDGET_MS = 10_000;

export type PinRepair =
  | { kind: "repaired"; token: string; at: number; was: string; is: string }
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "outOfTime" }
  | { kind: "couldNotRun"; why: string };

function payloadOf(token: string): string | null {
  try {
    return String.fromCharCode(...fromB64url(token));
  } catch {
    // A variant that isn't base64url decodes to no payload, so it can't be the owner's token.
    return null;
  }
}

export async function repairPin(token: string, check: (variant: string) => Promise<PinCheck>, budgetMs: number, now: () => number = () => performance.now()): Promise<PinRepair> {
  const deadline = now() + budgetMs;
  const found = new Map<string, { token: string; at: number }>();
  for (let at = 0; at < token.length; at++) {
    const variants = [...ALPHABET].filter((c) => c !== token[at]).map((c) => `${token.slice(0, at)}${c}${token.slice(at + 1)}`);
    const checks = await Promise.all(variants.map(check));
    if (now() > deadline) return { kind: "outOfTime" };
    for (const [i, result] of checks.entries()) {
      if (result.kind === "couldNotRun") return { kind: "couldNotRun", why: result.why };
      if (result.kind !== "fits") continue;
      const payload = payloadOf(variants[i]!);
      if (payload !== null && !found.has(payload)) found.set(payload, { token: variants[i]!, at });
    }
  }
  if (found.size > 1) return { kind: "ambiguous" };
  const [only] = found.values();
  if (!only) return { kind: "none" };
  return { kind: "repaired", token: only.token, at: only.at + 1, was: token[only.at]!, is: only.token[only.at]! };
}
