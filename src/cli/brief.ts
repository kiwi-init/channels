import { briefText } from "../brief.ts";
import { loadConfig } from "../config.ts";
import { wakeHooked, wakeOn } from "../daemon.ts";
import { howMessagesReachYou, mcFor } from "../hooks.ts";
import type { Persona } from "@kiwi/core/personality.ts";
import type { Scope } from "@kiwi/core/scopes.ts";

function listenLine(mc: string, alias: string, agent: string): string {
  const cfg = loadConfig();
  return howMessagesReachYou(mc, wakeOn(cfg, alias, agent), undefined, wakeHooked(cfg, alias, agent));
}

export function joinedText(
  alias: string,
  agent: string,
  as: { scopes?: readonly Scope[]; hold?: string | null; charter?: string | null; lead?: string | null; human?: string | null; persona?: Persona } = {},
): string {
  const mc = mcFor(alias, agent);
  return briefText({ alias, agent, mc, listen: listenLine(mc, alias, agent), contextLine: loadConfig().contextLine === "on", ...as });
}

export function agentPrompt(
  alias: string,
  agent: string,
  as: { scopes?: readonly Scope[]; human?: string | null; hold?: string | null; charter?: string | null; lead?: string | null; persona?: Persona } = {},
): string {
  return joinedText(alias, agent, as);
}
