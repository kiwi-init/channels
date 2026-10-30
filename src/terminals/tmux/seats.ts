import type { TmuxSeat } from "@kiwi/core/terminals.ts";
import { allSeats, loadConfig, type Config } from "../../config.ts";
import { onHostedSocket } from "../shared/tmux.ts";

export function tmuxSeats(cfg: Config = loadConfig(), hosted = false): TmuxSeat[] {
  const seats: TmuxSeat[] = [];
  const seen = new Set<string>();
  for (const record of allSeats(cfg)) {
    if (!record.tmux || onHostedSocket(record.tmux.socket) !== hosted) continue;
    const key = `${record.alias}\u0000${record.as}\u0000${record.tmux.socket}\u0000${record.tmux.pane}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const room = cfg.channels[record.alias]?.roomId;
    seats.push({ alias: record.alias, agent: record.as, ...(room ? { room } : {}), ...record.tmux });
  }
  return seats.sort((a, b) => a.alias.localeCompare(b.alias) || a.agent.localeCompare(b.agent) || a.pane.localeCompare(b.pane));
}

export const hostedSeats = (cfg: Config = loadConfig()): TmuxSeat[] => tmuxSeats(cfg, true);
