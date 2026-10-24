import { isKnownHarness } from "@kiwi/core/harnesses.ts";
import { readLaunchChoices } from "@kiwi/core/launch-options.ts";
import { readLaunch } from "@kiwi/core/membership.ts";
import { readLaunched, type LaunchedView } from "@kiwi/core/terminals.ts";
import type { LaunchAgentRequest } from "./bridge.ts";

const NICK = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,39}$/u;
const RELAY = /^https?:\/\/[^/?#\s]+$/;
const TOKEN = /^[A-Za-z0-9_.~=-]{1,4096}$/;
export const MACHINE_PK = /^[A-Za-z0-9_-]{20,128}$/;

const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);

export function launchRequestOf(v: unknown): LaunchAgentRequest | null {
  if (!v || typeof v !== "object") return null;
  const x = v as Record<string, unknown>;
  const launch = readLaunch(x["launch"]);
  const folder = text(x["folder"], 4096);
  const code = text(x["code"], 512);
  const relay = text(x["relay"], 512);
  const nick = x["nick"] === undefined ? undefined : text(x["nick"], 40);
  const persona = x["persona"] === undefined ? undefined : text(x["persona"], 4096);
  if (!launch || !isKnownHarness(x["harness"]) || !folder?.startsWith("/") || !code || !TOKEN.test(code) || !relay || !RELAY.test(relay)) return null;
  if ((x["nick"] !== undefined && (!nick || !NICK.test(nick))) || (x["persona"] !== undefined && (!persona || !TOKEN.test(persona)))) return null;
  const machinePk = x["machinePk"];
  if (machinePk !== undefined && (typeof machinePk !== "string" || !MACHINE_PK.test(machinePk))) return null;
  const choices = readLaunchChoices(x);
  if (!choices) return null;
  return { ...(machinePk ? { machinePk } : {}), launch, harness: x["harness"], folder, code, relay, ...(nick ? { nick } : {}), ...(persona ? { persona } : {}), ...choices };
}

export function launchedView(v: unknown): LaunchedView {
  const r = readLaunched(v);
  if (!r) return { ok: false, why: "failed", detail: "the daemon answered a launch in a shape this app doesn't know" };
  if (!r.ok) return { ok: false, why: r.why, detail: r.detail.length <= 400 ? r.detail : "" };
  const p = r.placed;
  if (p.place === "rex") return { ok: true, launch: r.launch, place: "rex", rex: p.rex };
  if (p.place === "tmux") return { ok: true, launch: r.launch, place: "tmux", session: p.session, window: p.window };
  return { ok: true, launch: r.launch, place: "terminal" };
}
