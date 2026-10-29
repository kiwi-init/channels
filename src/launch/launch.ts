import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { KnownHarness } from "@kiwi/core/harnesses.ts";
import { compareVersions } from "@kiwi/core/versions.ts";
import { home, loadConfig, type Config } from "../config.ts";
import { appendRotated } from "../daemon/wake.ts";
import { installHooks, listenHooksInstalled, REWAKE_SINCE } from "../hooks/install/claude.ts";
import { EXTRA_HARNESSES, extraInstalled, installExtra, type ExtraHarness } from "../hooks/install/extra.ts";
import { tooBroad } from "../seats.ts";
import { harnessInventory } from "./harnesses.ts";
import { launchesOn } from "../terminals/registry.ts";
import { openHosted, paneOf, type Hosted } from "./place.ts";
import { joinLineRefusal } from "@kiwi/core/join-line.ts";
import { choicesOf } from "@kiwi/core/launch-options.ts";
import { canStart, joinPrompt, launchChoicesRefusal, recipeArgv, typedPrompt } from "./recipes.ts";
import { typeWhenReady, type Typed, type TypeOptions } from "./typed.ts";
import type { Launched } from "@kiwi/core/terminals.ts";
import type { LaunchRequest } from "./wire.ts";

export interface LaunchOptions {
  PATH?: string;
  config?: Pick<Config, "launch">;
  hosted: Hosted;
  typing?: TypeOptions;
  onTyped?: (typed: Typed, launch: string) => void;
}

const TYPED_WORDS: Record<Typed, string> = { typed: "typed its first prompt", failed: "couldn't type its first prompt", late: "its ready screen never showed, so its first prompt wasn't typed" };

function noteTyped(harness: KnownHarness, typed: Typed, launch: string): void {
  try {
    appendRotated(join(home(), "launch.log"), `${new Date().toISOString()}\t${launch}\t${harness}\t${TYPED_WORDS[typed]}\n`);
  } catch {
    // A home Kiwi can't write to keeps no launch log; the agent's window still shows how it went.
  }
}

const isExtra = (h: KnownHarness): h is KnownHarness & ExtraHarness => (EXTRA_HARNESSES as readonly string[]).includes(h);

function folderRefusal(folder: string): string | null {
  if (!isAbsolute(folder)) return `${folder} isn't a full path`;
  if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) return `${folder} isn't a folder`;
  if (tooBroad(folder)) return "an agent can't work from the home folder or /: pick a project's folder";
  return null;
}

function hookUp(harness: KnownHarness, version: string | null): void {
  if (process.env.KIWI_NO_HOOKS) return;
  const cfg = loadConfig();
  try {
    if (harness === "claude" && cfg.claudeHooks !== "off" && !listenHooksInstalled()) installHooks(!!version && compareVersions(version, REWAKE_SINCE.join(".")) >= 0);
    else if (isExtra(harness) && cfg.harnessHooks?.[harness] !== "off" && !extraInstalled(harness)) installExtra(harness);
  } catch {
    // A settings file Kiwi can't parse doesn't stop the launch: the agent still joins, and kiwi hooks status says what's missing.
  }
}

export async function launchAgent(req: LaunchRequest, opts: LaunchOptions): Promise<Launched> {
  const cfg = opts.config ?? loadConfig();
  if (!launchesOn(cfg)) return { ok: false, why: "not-allowed", detail: "Creating new agents is off on this computer (kiwi launches on turns it back on)" };
  const refused = joinLineRefusal(req) ?? folderRefusal(req.folder);
  if (refused) return { ok: false, why: "bad-request", detail: refused };
  if (!canStart(req.harness)) return { ok: false, why: "no-recipe", detail: `Kiwi can't start ${req.harness} yet` };
  const choices = choicesOf(req);
  const unchosen = launchChoicesRefusal(req.harness, choices);
  if (unchosen) return { ok: false, why: "bad-request", detail: unchosen };
  const row = (await harnessInventory(opts.PATH)).find((r) => r.harness === req.harness);
  const argv = row?.path ? recipeArgv(req.harness, row.path, joinPrompt(req), choices) : null;
  if (!row?.path || !argv) return { ok: false, why: "not-installed", detail: `${req.harness} isn't installed on this computer` };
  const typed = typedPrompt(req.harness);
  hookUp(req.harness, row.version);
  const launch = req.launch ?? randomBytes(16).toString("base64url");
  const env = { KIWI_LAUNCH: launch, ...(process.env.KIWI_HOME ? { KIWI_HOME: process.env.KIWI_HOME } : {}) };
  const placed = await openHosted({ argv, folder: req.folder, name: req.nick ?? req.harness, env }, opts.hosted);
  if (!placed.ok) return placed;
  if (typed) {
    const pane = paneOf(placed, opts.hosted);
    if (!pane) return { ok: false, why: "failed", detail: "it opened, but Kiwi can't type into its window: type the kiwi join line from the app into it" };
    const done = opts.onTyped ?? ((t: Typed, id: string) => noteTyped(req.harness, t, id));
    void typeWhenReady(pane, joinPrompt(req), typed, opts.typing).then((t) => done(t, launch));
  }
  return { ok: true, launch, placed };
}
