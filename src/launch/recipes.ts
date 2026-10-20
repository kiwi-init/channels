import { decodeJoinCode } from "@kiwi/core/crypto.ts";
import type { KnownHarness } from "@kiwi/core/harnesses.ts";
import { MAX_PIN } from "@kiwi/core/pin.ts";

export interface JoinLine {
  code: string;
  relay?: string;
  nick?: string;
  persona?: string;
}

const RECIPES: Partial<Record<KnownHarness, (bin: string, prompt: string) => string[]>> = {
  claude: (bin, prompt) => [bin, "--allowedTools", "Bash(kiwi join:*)", "--", prompt],
  codex: (bin, prompt) => [bin, prompt],
};

export function canStart(harness: KnownHarness): boolean {
  return harness in RECIPES;
}

export function recipeArgv(harness: KnownHarness, bin: string, prompt: string): string[] | null {
  return RECIPES[harness]?.(bin, prompt) ?? null;
}

const NICK = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,39}$/u;
const TOKEN = /^[A-Za-z0-9_-]+$/;
const RELAY = /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/?$/;

export function joinLineRefusal(j: JoinLine): string | null {
  try {
    decodeJoinCode(j.code);
  } catch {
    return "that isn't a join code (they look like mc2-…-…)";
  }
  if (j.relay !== undefined && !RELAY.test(j.relay)) return "the relay is an http(s) address with no path";
  if (j.nick !== undefined && !NICK.test(j.nick)) return "a nickname is 1 to 40 letters, digits, spaces, _ . or -, starting with a letter or digit";
  if (j.persona !== undefined && (j.persona.length > MAX_PIN || !TOKEN.test(j.persona))) return "the personality is the token from an invite, as it was copied";
  return null;
}

export function joinPrompt(j: JoinLine): string {
  const command = ["kiwi", "join", j.code, ...(j.relay ? ["--relay", j.relay] : []), ...(j.nick ? ["--nick", `'${j.nick}'`] : []), ...(j.persona ? ["--persona", j.persona] : [])].join(" ");
  return `Your person started you from the Channels app to join one of their Kiwi channels. Run this command now, and leave it running until it prints "joined": ${command}. Then follow what it prints.`;
}
