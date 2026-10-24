import type { KnownHarness } from "@kiwi/core/harnesses.ts";
import type { JoinLine } from "@kiwi/core/join-line.ts";
import { choicesRefusal, PERMISSIONS, type HarnessOptions, type LaunchChoices, type Permission } from "@kiwi/core/launch-options.ts";
import { CLAUDE_1M, CLAUDE_EFFORTS, claudeArgv, claudeContextRefusal } from "../loop/claude.ts";
import { CODEX_CONTEXTS, CODEX_EFFORTS, codexArgv } from "../loop/codex.ts";
import { GROK_EFFORTS, grokArgv } from "../loop/grok.ts";
import { kimiArgv, kimiScreen } from "../loop/kimi.ts";
import { MIMO_PERMISSIONS, mimoArgv } from "../loop/mimo.ts";
import type { Screen } from "./typed.ts";

interface LaunchRecipe {
  label: string;
  options: HarnessOptions;
  argv: (bin: string, prompt: string, choices: LaunchChoices) => string[];
  refuse?: (choices: LaunchChoices) => string | null;
  typed?: (screen: string) => Screen;
}

const GEMINI_MODES: Record<Permission, string | null> = { default: null, "accept-edits": "auto_edit", plan: "plan", bypass: "yolo" };

function geminiArgv(bin: string, prompt: string, { model, permission }: LaunchChoices): string[] {
  const mode = permission ? GEMINI_MODES[permission] : null;
  return [bin, ...(model ? ["-m", model] : []), ...(mode ? ["--approval-mode", mode] : []), "-i", prompt];
}

const PI_THINKING = ["off", "minimal", "low", "medium", "high", "xhigh"];

function piArgv(bin: string, prompt: string, { model, effort }: LaunchChoices): string[] {
  return [bin, ...(model ? ["--model", model] : []), ...(effort ? ["--thinking", effort] : []), prompt];
}

const OPENCODE_PERMISSIONS: Permission[] = ["default", "plan", "bypass"];

function opencodeArgv(bin: string, prompt: string, { model, permission }: LaunchChoices): string[] {
  if (model || permission === "plan") return [bin, "mini", ...(model ? ["--model", model] : []), ...(permission === "plan" ? ["--agent", "plan"] : []), "--prompt", prompt];
  return [bin, ...(permission === "bypass" ? ["--auto"] : []), "--prompt", prompt];
}

const RECIPES: Partial<Record<KnownHarness, LaunchRecipe>> = {
  claude: {
    label: "Claude Code",
    options: { model: true, effort: CLAUDE_EFFORTS, permission: [...PERMISSIONS], context: [CLAUDE_1M] },
    argv: (bin, prompt, choices) => claudeArgv({ ...choices, bin, tools: "Bash(kiwi join:*)", prompt }),
    refuse: (choices) => claudeContextRefusal(choices.model, choices.context),
  },
  codex: {
    label: "Codex",
    options: { model: true, effort: CODEX_EFFORTS, permission: [...PERMISSIONS], context: CODEX_CONTEXTS },
    argv: (bin, prompt, choices) => codexArgv({ ...choices, bin, prompt }),
  },
  grok: {
    label: "Grok",
    options: { model: true, effort: GROK_EFFORTS, permission: [...PERMISSIONS], context: [] },
    argv: (bin, prompt, choices) => grokArgv({ ...choices, bin, prompt }),
  },
  gemini: {
    label: "Gemini CLI",
    options: { model: true, effort: [], permission: [...PERMISSIONS], context: [] },
    argv: geminiArgv,
  },
  pi: {
    label: "Pi",
    options: { model: true, effort: PI_THINKING, permission: [], context: [] },
    argv: piArgv,
  },
  kimi: {
    label: "Kimi Code",
    options: { model: true, effort: [], permission: [...PERMISSIONS], context: [] },
    argv: (bin, _prompt, choices) => kimiArgv({ ...choices, bin }),
    typed: kimiScreen,
  },
  opencode: {
    label: "OpenCode",
    options: { model: true, effort: [], permission: OPENCODE_PERMISSIONS, context: [] },
    argv: (bin, prompt, choices) => opencodeArgv(bin, prompt, choices),
    refuse: (choices) =>
      choices.model && choices.permission === "bypass"
        ? "OpenCode skips its permission prompts (--auto) only in its full interface, which can't pick a model: leave the model empty to start it with Bypass"
        : null,
  },
  mimo: {
    label: "MiMoCode",
    options: { model: true, effort: [], permission: MIMO_PERMISSIONS, context: [] },
    argv: (bin, prompt, choices) => mimoArgv({ ...choices, bin, prompt }),
  },
};

export function canStart(harness: KnownHarness): boolean {
  return harness in RECIPES;
}

export function harnessLabel(harness: KnownHarness): string {
  return RECIPES[harness]?.label ?? harness;
}

export function typedPrompt(harness: KnownHarness): ((screen: string) => Screen) | null {
  return RECIPES[harness]?.typed ?? null;
}

export function harnessOptions(harness: KnownHarness): HarnessOptions | null {
  return RECIPES[harness]?.options ?? null;
}

export function launchChoicesRefusal(harness: KnownHarness, choices: LaunchChoices): string | null {
  const recipe = RECIPES[harness];
  if (!recipe) return null;
  return choicesRefusal(recipe.label, recipe.options, choices) ?? recipe.refuse?.(choices) ?? null;
}

export function recipeArgv(harness: KnownHarness, bin: string, prompt: string, choices: LaunchChoices = {}): string[] | null {
  return RECIPES[harness]?.argv(bin, prompt, choices) ?? null;
}

export function joinPrompt(j: JoinLine): string {
  const command = ["kiwi", "join", j.code, ...(j.relay ? ["--relay", j.relay] : []), ...(j.nick ? ["--nick", `'${j.nick}'`] : []), ...(j.persona ? ["--persona", j.persona] : [])].join(" ");
  return `Your person started you from the Channels app to join one of their Kiwi channels. Run this command now, and leave it running until it prints "joined": ${command}. If it asks for your model, run it again with --model and the exact id of the model you run on. Then follow what it prints.`;
}
