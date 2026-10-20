import type { RexStatusView } from "./bridge.ts";

export const REX_UNKNOWN: RexStatusView = { found: false, server: "stopped", helpers: "off", rotation: "off" };

export function rexStatusOf(stdout: string): RexStatusView {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    // Not the one JSON object kiwi rex status --json writes: show nothing rather than guess.
    return REX_UNKNOWN;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return REX_UNKNOWN;
  const s = parsed as Record<string, unknown>;
  const version = typeof s["version"] === "string" && /^[\x21-\x7e]{1,64}$/.test(s["version"]) ? s["version"] : null;
  return {
    found: s["found"] === true,
    ...(version ? { version } : {}),
    server: s["server"] === "running" ? "running" : "stopped",
    helpers: s["helpers"] === "on" ? "on" : "off",
    rotation: s["rotation"] === "on" ? "on" : "off",
  };
}
