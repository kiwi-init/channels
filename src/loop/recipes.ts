import { loadConfig } from "../config.ts";
import { extraInstalled, hooksInstalled, installExtra, installHooks } from "../hooks.ts";
import type { HeldSession } from "../hold.ts";
import { claudeArgv, claudeSession } from "./claude.ts";
import { codexArgv, codexIdle, codexThread } from "./codex.ts";
import { grokArgv, grokIdle, grokSession } from "./grok.ts";
import { startListener } from "../hooks/reach.ts";

export const LOOP_HARNESSES = ["claude", "codex", "grok"] as const;

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
  firstLine: string | null;
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
        firstLine: null,
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
        firstLine: null,
        hooks: () => (process.env.KIWI_NO_HOOKS || loadConfig().harnessHooks?.codex === "off" || extraInstalled("codex") ? null : installExtra("codex")),
        started: (pid, since, nonce) => {
          const found = codexThread(nonce, since);
          return found ? { id: found.thread, bound: { harness, session: found.thread, pid }, idle: () => codexIdle(found.rollout) } : null;
        },
      };
    case "grok":
      return {
        harness,
        label: "Grok",
        argv: grokArgv,
        firstLine: startListener("kiwi", "grok"),
        hooks: () => (process.env.KIWI_NO_HOOKS || loadConfig().harnessHooks?.grok === "off" || extraInstalled("grok") ? null : installExtra("grok")),
        started: (pid, since, nonce) => {
          const found = grokSession(nonce, since);
          return found ? { id: found.session, bound: { harness, session: found.session, pid }, idle: () => grokIdle(found.dir) } : null;
        },
      };
    default: {
      const never: never = harness;
      return never;
    }
  }
}
