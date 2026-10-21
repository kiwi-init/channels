import type { RexSeat } from "@kiwi/core/terminals.ts";
import { loadConfig, type Config } from "./config.ts";
import { rexApi, rexApiArgv, rexBinary, type RexPlace } from "./rex.ts";
import { listIn, object, parseJson } from "./terminals/shared/json.ts";
import { runNow } from "./terminals/shared/run.ts";

export function localRexSeats(cfg: Config = loadConfig()): RexSeat[] {
  const seats: RexSeat[] = [];
  const seen = new Set<string>();
  for (const value of Object.values(cfg.bindings ?? {})) {
    for (const record of Array.isArray(value) ? value : [value]) {
      if (!record.rex) continue;
      const key = `${record.alias}\u0000${record.as}\u0000${record.rex.server}\u0000${record.rex.block}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const room = cfg.channels[record.alias]?.roomId;
      seats.push({ alias: record.alias, agent: record.as, ...(room ? { room } : {}), ...record.rex });
    }
  }
  return seats.sort((a, b) => a.alias.localeCompare(b.alias) || a.agent.localeCompare(b.agent) || a.block.localeCompare(b.block));
}

type RexShowWhy = "no-rex" | "no-server" | "no-app" | "remote-control" | "failed";
export type RexShow = { ok: true } | { ok: false; why: RexShowWhy };

function appClient(value: unknown): boolean {
  return (listIn(value, ["clients", "values", "list"], true) ?? []).some((client) => {
    const record = object(client);
    const info = object(record?.info);
    return info?.kind === "app" || record?.kind === "app";
  });
}

function said(body: string): RexShowWhy {
  const text = body.toLowerCase();
  return text.includes("remote") || text.includes("control") ? "remote-control" : "failed";
}

export function showInRex(place: RexPlace, bin: string | null = rexBinary()): RexShow {
  if (!bin) return { ok: false, why: "no-rex" };
  const listed = runNow([bin, ...rexApiArgv(place.server, "client.list", {})]);
  if (listed.status === 4) return { ok: false, why: "no-server" };
  if (listed.status !== 0) return { ok: false, why: "failed" };
  if (!appClient(parseJson(listed.stdout))) return { ok: false, why: "no-app" };
  const focused = rexApi(place, "session.focus_block", { block_id: place.block }, bin, true);
  if (focused === null) return { ok: false, why: "failed" };
  const selected = runNow([bin, "-S", place.server, "do", "session.select", `session_id=${place.session}`], 10_000);
  if (selected.status === 0) return { ok: true };
  if (selected.status === 4) return { ok: false, why: "no-server" };
  return { ok: false, why: said(`${selected.stdout}\n${selected.stderr}`) };
}
