import { briefText } from "../brief.ts";
import { loadConfig } from "../config.ts";
import { wakeOn } from "../daemon.ts";
import { howMessagesReachYou, mcFor } from "../hooks.ts";
import type { Scope } from "@kiwi/core/scopes.ts";

function listenLine(mc: string, alias: string, agent: string): string {
  return howMessagesReachYou(mc, wakeOn(loadConfig(), alias, agent));
}

export function joinedText(
  alias: string,
  agent: string,
  as: { scopes?: readonly Scope[]; hold?: string | null; charter?: string | null; lead?: string | null; human?: string | null; role?: string; about?: string } = {},
): string {
  const mc = mcFor(alias, agent);
  return briefText({ alias, agent, mc, listen: listenLine(mc, alias, agent), ...as });
}

export function agentPrompt(
  alias: string,
  agent: string,
  as: { role?: string; about?: string; scopes?: readonly Scope[]; human?: string | null; hold?: string | null; charter?: string | null; lead?: string | null } = {},
): string {
  return joinedText(alias, agent, as);
}
