import { isKnownHarness, type KnownHarness } from "@kiwi/core/harnesses.ts";
import { readLaunch } from "@kiwi/core/membership.ts";
import { PLACE_NAMES, type Launched } from "@kiwi/core/terminals.ts";
import type { JoinLine } from "@kiwi/core/join-line.ts";

export interface LaunchRequest extends JoinLine {
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
  return { harness: x.harness, folder, code, ...(relay ? { relay } : {}), ...(nick ? { nick } : {}), ...(persona ? { persona } : {}), ...(launch ? { launch } : {}) };
}

export function launchedText(r: Launched): string {
  if (!r.ok) return r.detail;
  const p = r.placed;
  const where = p.place === "tmux" ? `${PLACE_NAMES.tmux} window ${p.window} of session ${p.session} (tmux attach -t ${p.session})` : `a ${PLACE_NAMES[p.place]} window`;
  return `started in ${where}${p.instead ? ` (${p.instead})` : ""}; it joins with launch ${r.launch}`;
}
