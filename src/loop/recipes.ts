import { loadConfig } from "../config.ts";
import { extraInstalled, hooksInstalled, installExtra, installHooks } from "../hooks.ts";
import type { HeldSession } from "../hold.ts";
import { claudeArgv, claudeSession } from "./claude.ts";
import { codexArgv, codexIdle, codexThread } from "./codex.ts";
import { grokArgv, grokIdle, grokSession } from "./grok.ts";
import { mimoArgv, mimoIdle, mimoSession } from "./mimo.ts";
import { kimiArgv, kimiIdle, kimiScreen, kimiSession, type KimiScreen } from "./kimi.ts";
import { zcodeArgv, zcodeIdle, zcodeProcess, zcodeScreen, zcodeSession } from "./zcode.ts";
import { installMimo, mimoInstalled } from "../hooks/install/mimo.ts";
import { startListener } from "../hooks/reach.ts";

export const LOOP_HARNESSES = ["claude", "codex", "grok", "mimo", "kimi", "zcode"] as const;

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
  program: string;
  bin: string;
  argv: (launch: Launch) => string[];
  hooks: () => string | null;
  firstLine: string | null;
  stopSignal: "SIGTERM" | "SIGINT";
  takesEffort: boolean;
  takesModel: boolean;
  screen: ((text: string) => KimiScreen) | null;
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
        program: harness,
        argv: claudeArgv,
        firstLine: null,
        stopSignal: "SIGTERM",
        takesEffort: true,
        takesModel: true,
        screen: null,
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
        program: harness,
        argv: codexArgv,
        firstLine: null,
        stopSignal: "SIGTERM",
        takesEffort: true,
        takesModel: true,
        screen: null,
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
        program: harness,
        argv: grokArgv,
        firstLine: startListener("kiwi", "grok"),
        stopSignal: "SIGTERM",
        takesEffort: true,
        takesModel: true,
        screen: null,
        hooks: () => (process.env.KIWI_NO_HOOKS || loadConfig().harnessHooks?.grok === "off" || extraInstalled("grok") ? null : installExtra("grok")),
        started: (pid, since, nonce) => {
          const found = grokSession(nonce, since);
          return found ? { id: found.session, bound: { harness, session: found.session, pid }, idle: () => grokIdle(found.dir) } : null;
        },
      };
    case "mimo":
      return {
        harness,
        label: "MiMoCode",
        program: harness,
        argv: (launch) => mimoArgv(launch),
        firstLine: null,
        stopSignal: "SIGINT",
        takesEffort: false,
        takesModel: true,
        screen: null,
        hooks: () => (process.env.KIWI_NO_HOOKS || loadConfig().harnessHooks?.mimo === "off" || mimoInstalled() ? null : installMimo()),
        started: (pid, since, nonce) => {
          const found = mimoSession(nonce, since);
          return found ? { id: found, bound: { harness, session: found, pid }, idle: () => mimoIdle(found) } : null;
        },
      };
    case "kimi":
      return {
        harness,
        label: "Kimi Code",
        program: harness,
        argv: (launch) => kimiArgv(launch),
        firstLine: startListener("kiwi", "kimi"),
        stopSignal: "SIGTERM",
        takesEffort: false,
        takesModel: true,
        screen: kimiScreen,
        hooks: () => (process.env.KIWI_NO_HOOKS || loadConfig().harnessHooks?.kimi === "off" || extraInstalled("kimi") ? null : installExtra("kimi")),
        started: (pid, since, nonce) => {
          const found = kimiSession(nonce, since);
          return found ? { id: found.session, bound: { harness, pid }, idle: () => kimiIdle(found.dir) } : null;
        },
      };
    case "zcode":
      return {
        harness,
        label: "ZCode",
        program: "zcode-cli",
        argv: zcodeArgv,
        firstLine: startListener("kiwi", "zcode"),
        stopSignal: "SIGTERM",
        takesEffort: false,
        takesModel: false,
        screen: zcodeScreen,
        hooks: () => (process.env.KIWI_NO_HOOKS || loadConfig().harnessHooks?.zcode === "off" || extraInstalled("zcode") ? null : installExtra("zcode")),
        started: (pid, since, nonce) => {
          const session = zcodeSession(nonce, since);
          const zpid = session ? zcodeProcess(pid) : null;
          return session && zpid ? { id: session, bound: { harness, session: `zcode-pid-${zpid}`, pid: zpid }, idle: () => zcodeIdle(session) } : null;
        },
      };
    default: {
      const never: never = harness;
      return never;
    }
  }
}
