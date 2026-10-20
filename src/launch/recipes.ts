import type { KnownHarness } from "@kiwi/core/harnesses.ts";
import type { JoinLine } from "@kiwi/core/join-line.ts";

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

export function joinPrompt(j: JoinLine): string {
  const command = ["kiwi", "join", j.code, ...(j.relay ? ["--relay", j.relay] : []), ...(j.nick ? ["--nick", `'${j.nick}'`] : []), ...(j.persona ? ["--persona", j.persona] : [])].join(" ");
  return `Your person started you from the Channels app to join one of their Kiwi channels. Run this command now, and leave it running until it prints "joined": ${command}. If it asks for your model, run it again with --model and the exact id of the model you run on. Then follow what it prints.`;
}
