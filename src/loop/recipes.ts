import { loadConfig } from "../config.ts";
import { extraInstalled, hooksInstalled, installExtra, installHooks } from "../hooks.ts";
import type { HeldSession } from "../hold.ts";
import { claudeArgv, claudeSession } from "./claude.ts";
import { codexArgv, codexIdle, codexThread } from "./codex.ts";

export const LOOP_HARNESSES = ["claude", "codex"] as const;

export type LoopHarness = (typeof LOOP_HARNESSES)[number];

interface Launch {
  bin: string;
  model?: string;
  effort?: string;
  prompt: string;
}

type Idle = { idle: boolean; since: number | null };

export interface Started {
  id: string;
  bound: HeldSession;
  idle: () => Idle;
}

export interface Recipe {
  harness: LoopHarness;
  label: string;
  bin: string;
  argv: (launch: Launch) => string[];
  hooks: () => string | null;
  started: (pid: number, since: number, nonce: string) => Started | null;
}

export function isLoopHarness(v: string): v is LoopHarness {
  return LOOP_HARNESSES.some((h) => h === v);
}

export function recipeFor(harness: LoopHarness): Omit<Recipe, "bin"> {
  switch (harness) {
    case "claude":
      return {
        harness,
        label: "Claude Code",
        argv: claudeArgv,
        hooks: () => (process.env.KIWI_NO_HOOKS || loadConfig().claudeHooks === "off" || hooksInstalled() ? null : installHooks()),
        started: (pid) => {
          const found = claudeSession(pid);
          return found ? { id: found.sessionId, bound: { harness, session: found.sessionId, pid }, idle: () => claudeSession(pid) ?? { idle: false, since: null } } : null;
        },
      };
    case "codex":
      return {
        harness,
        label: "Codex",
        argv: codexArgv,
        hooks: () => (process.env.KIWI_NO_HOOKS || loadConfig().harnessHooks?.codex === "off" || extraInstalled("codex") ? null : installExtra("codex")),
        started: (pid, since, nonce) => {
          const found = codexThread(nonce, since);
          return found ? { id: found.thread, bound: { harness, session: found.thread, pid }, idle: () => codexIdle(found.rollout) } : null;
        },
      };
    default: {
      const never: never = harness;
      return never;
    }
  }
}
