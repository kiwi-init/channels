import { isKnownHarness } from "@kiwi/core/harnesses.ts";
import { readLaunch } from "@kiwi/core/membership.ts";
import type { LaunchAgentRequest, LaunchedView } from "./bridge.ts";

const NICK = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,39}$/u;
const RELAY = /^https?:\/\/[^/?#\s]+$/;
const TOKEN = /^[A-Za-z0-9_.~=-]{1,4096}$/;

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
  return { launch, harness: x["harness"], folder, code, relay, ...(nick ? { nick } : {}), ...(persona ? { persona } : {}) };
}

const WHYS = ["bad-request", "not-installed", "no-recipe", "no-place", "not-allowed", "failed"] as const;
type Why = (typeof WHYS)[number];
const isWhy = (v: unknown): v is Why => typeof v === "string" && (WHYS as readonly string[]).includes(v);

export function launchedView(v: unknown): LaunchedView {
  const r = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  if (r["ok"] === false) return { ok: false, why: isWhy(r["why"]) ? r["why"] : "failed", detail: text(r["detail"], 400) ?? "" };
  const launch = readLaunch(r["launch"]);
  const placed = r["placed"] && typeof r["placed"] === "object" ? (r["placed"] as Record<string, unknown>) : null;
  if (r["ok"] !== true || !launch || placed?.["ok"] !== true) return { ok: false, why: "failed", detail: "the daemon answered a launch in a shape this app doesn't know" };
  if (placed["place"] === "terminal") return { ok: true, launch, place: "terminal" };
  if (placed["place"] === "tmux") {
    const session = text(placed["session"], 128);
    const window = text(placed["window"], 32);
    if (session && window) return { ok: true, launch, place: "tmux", session, window };
  }
  if (placed["place"] === "rex") {
    const rex = placed["rex"] && typeof placed["rex"] === "object" ? (placed["rex"] as Record<string, unknown>) : {};
    const server = text(rex["server"], 512);
    const session = text(rex["session"], 128);
    const block = text(rex["block"], 128);
    if (server && session && block) return { ok: true, launch, place: "rex", rex: { server, session, block } };
  }
  return { ok: false, why: "failed", detail: "the daemon answered a launch in a shape this app doesn't know" };
}
