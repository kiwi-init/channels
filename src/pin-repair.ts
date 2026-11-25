import { fromB64url } from "@kiwi/core/crypto.ts";
import { canonical } from "@kiwi/core/identity.ts";
import type { PinCheck } from "@kiwi/core/pin.ts";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export const REPAIR_BUDGET_MS = 10_000;

export type PinRepair =
  | { kind: "repaired"; token: string; at: number; was: string; is: string }
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "outOfTime" }
  | { kind: "couldNotRun"; why: string };

const hex = (b64: unknown) => (typeof b64 === "string" ? Array.from(fromB64url(b64), (b) => b.toString(16).padStart(2, "0")).join("") : b64);

function signedContent(token: string): string | null {
  try {
    const o = JSON.parse(new TextDecoder().decode(fromB64url(token))) as Record<string, unknown>;
    return canonical({ ...o, pk: hex(o.pk), sig: hex(o.sig) });
  } catch {
    // A variant that doesn't decode carries no signed content, so it can't be the owner's token.
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
      const content = signedContent(variants[i]!);
      if (content !== null && !found.has(content)) found.set(content, { token: variants[i]!, at });
    }
  }
  if (found.size > 1) return { kind: "ambiguous" };
  const [only] = found.values();
  if (!only) return { kind: "none" };
  return { kind: "repaired", token: only.token, at: only.at + 1, was: token[only.at]!, is: only.token[only.at]! };
}
