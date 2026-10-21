import type { TmuxSeat } from "@kiwi/core/terminals.ts";
import { allSeats, loadConfig, type Config } from "../../config.ts";
import type { ShowResult, TmuxPlace } from "../plugin.ts";
import { run } from "../shared/run.ts";

const NO_SERVER = /no server running|error connecting to/;

export function localTmuxSeats(cfg: Config = loadConfig()): TmuxSeat[] {
  const seats: TmuxSeat[] = [];
  const seen = new Set<string>();
  for (const record of allSeats(cfg)) {
    if (!record.tmux) continue;
    const key = `${record.alias}\u0000${record.as}\u0000${record.tmux.socket}\u0000${record.tmux.pane}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const room = cfg.channels[record.alias]?.roomId;
    seats.push({ alias: record.alias, agent: record.as, ...(room ? { room } : {}), ...record.tmux });
  }
  return seats.sort((a, b) => a.alias.localeCompare(b.alias) || a.agent.localeCompare(b.agent) || a.pane.localeCompare(b.pane));
}

export async function showPane(place: TmuxPlace, tmux: string): Promise<ShowResult> {
  const cmd = (...args: string[]) => run([tmux, "-S", place.socket, ...args], 5_000);
  const found = await cmd("display-message", "-p", "-t", place.pane, "#{window_id}");
  if (found.status !== 0 && NO_SERVER.test(found.stderr)) return { ok: false, why: "no-server" };
  const window = found.stdout.trim();
  if (found.status !== 0 || !/^@\d+$/.test(window)) return { ok: false, why: "failed" };
  if ((await cmd("select-window", "-t", window)).status !== 0 || (await cmd("select-pane", "-t", place.pane)).status !== 0) return { ok: false, why: "failed" };
  const clients = await cmd("list-clients", "-F", "#{client_activity}\t#{client_name}");
  const latest = clients.stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .flatMap(([at, name]) => (at && name ? [{ at: Number(at) || 0, name }] : []))
    .sort((a, b) => b.at - a.at)[0];
  if (!latest) return { ok: false, why: "no-app" };
  return (await cmd("switch-client", "-c", latest.name, "-t", place.pane)).status === 0 ? { ok: true } : { ok: false, why: "failed" };
}
