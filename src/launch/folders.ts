import { existsSync } from "node:fs";
import type { Config } from "../config.ts";
import { seatsAt } from "../seats.ts";

export function seatFolders(cfg: Config, room?: string): string[] {
  const latest = new Map<string, number>();
  for (const dir of Object.keys(cfg.bindings ?? {})) {
    for (const seat of seatsAt(cfg, dir)) {
      if (room && cfg.channels[seat.alias]?.roomId !== room) continue;
      latest.set(dir, Math.max(latest.get(dir) ?? 0, seat.seen ?? seat.at ?? 0));
    }
  }
  return [...latest]
    .filter(([dir]) => existsSync(dir))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([dir]) => dir);
}
