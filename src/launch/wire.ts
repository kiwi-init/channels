import { isKnownHarness, type KnownHarness } from "@kiwi/core/harnesses.ts";
import { readLaunch } from "@kiwi/core/membership.ts";
import { PLACE_NAMES, type Launched, type Opened } from "@kiwi/core/terminals.ts";
import { HOSTED_SESSION } from "../daemon/hosted-tmux.ts";
import type { JoinLine } from "@kiwi/core/join-line.ts";
import { readLaunchChoices, type LaunchChoices } from "@kiwi/core/launch-options.ts";

export interface LaunchRequest extends JoinLine, LaunchChoices {
  harness: KnownHarness;
  folder: string;
  launch?: string;
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export function readLaunchRequest(x: Record<string, unknown>): LaunchRequest | null {
  const folder = text(x.folder);
  const code = text(x.code);
  if (!isKnownHarness(x.harness) || !folder || !code) return null;
  const relay = text(x.relay);
  const nick = text(x.nick);
  const persona = text(x.persona);
  if (x.launch !== undefined && !readLaunch(x.launch)) return null;
  const launch = readLaunch(x.launch);
  const choices = readLaunchChoices(x);
  if (!choices) return null;
  return { harness: x.harness, folder, code, ...(relay ? { relay } : {}), ...(nick ? { nick } : {}), ...(persona ? { persona } : {}), ...(launch ? { launch } : {}), ...choices };
}

export function hostedWhere(p: Extract<Opened, { place: "hosted" }>): string {
  return `${PLACE_NAMES.hosted}' own tmux, window ${p.window} (to watch it: tmux -S ${p.socket} attach -t ${HOSTED_SESSION})`;
}

export function launchedText(r: Launched): string {
  if (!r.ok) return r.detail;
  const p = r.placed;
  const where =
    p.place === "tmux" ? `${PLACE_NAMES.tmux} window ${p.window} of session ${p.session} (tmux attach -t ${p.session})` : p.place === "hosted" ? hostedWhere(p) : `a ${PLACE_NAMES[p.place]} window`;
  return `started in ${where}${p.instead ? ` (${p.instead})` : ""}; it joins with launch ${r.launch}`;
}
