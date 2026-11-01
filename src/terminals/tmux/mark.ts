import type { SeatRecord } from "../../config.ts";
import type { StatusRecord, TmuxPlace } from "../plugin.ts";
import { run } from "../shared/run.ts";

const TASKS_SHOWN = 3;

const whole = (n: number | undefined): number => (n !== undefined && Number.isSafeInteger(n) && n > 0 ? n : 0);

export function markText(records: readonly StatusRecord[]): string {
  const asks = records.reduce((n, r) => n + (r.kind === "question" ? whole(r.count) || 1 : 0), 0);
  const tasks = [...new Set(records.map((r) => whole(r.task)).filter((t) => t > 0))].sort((a, b) => a - b);
  const more = tasks.length - TASKS_SHOWN;
  return [...(asks ? [`${asks}?`] : []), ...tasks.slice(0, TASKS_SHOWN).map((t) => `T${t}`), ...(more > 0 ? [`+${more}`] : [])].join(" ");
}

async function tmuxWindow(tmux: string, place: TmuxPlace): Promise<string | null> {
  const r = await run([tmux, "-u", "-S", place.socket, "display-message", "-p", "-t", place.pane, "#{window_id}"], 5_000);
  const id = r.stdout.trim();
  return r.status === 0 && /^@\d+$/.test(id) ? id : null;
}

interface Held {
  socket: string;
  window: string;
  seats: Map<string, readonly StatusRecord[]>;
}

export function tmuxMarker(bin: () => Promise<string>): (seat: SeatRecord, changed: readonly StatusRecord[], cleared: readonly string[], all: readonly StatusRecord[]) => Promise<boolean> {
  const windows = new Map<string, Held>();
  const seatAt = new Map<string, string>();

  const paint = async (held: Held): Promise<boolean> => {
    const tmux = await bin();
    const text = markText([...held.seats.values()].flat());
    const option = text ? ["-w", "-t", held.window, "@kiwi", text] : ["-wu", "-t", held.window, "@kiwi"];
    return (await run([tmux, "-u", "-S", held.socket, "set-option", ...option], 5_000)).status === 0;
  };

  const hold = (at: string, held: Held, seat: string, records: readonly StatusRecord[]): void => {
    if (records.length) held.seats.set(seat, records);
    else held.seats.delete(seat);
    if (held.seats.size) windows.set(at, held);
    else windows.delete(at);
  };

  return async (record, _changed, _cleared, all) => {
    if (!record.tmux) return false;
    const window = await tmuxWindow(await bin(), record.tmux);
    if (!window) return false;
    const at = `${record.tmux.socket}\u0000${window}`;
    const seat = `${record.alias}\u0000${record.as}`;
    const was = seatAt.get(seat);
    const left = was && was !== at ? windows.get(was) : undefined;
    if (was && left) {
      hold(was, left, seat, []);
      await paint(left);
    }
    seatAt.set(seat, at);
    const held = windows.get(at) ?? { socket: record.tmux.socket, window, seats: new Map<string, readonly StatusRecord[]>() };
    hold(at, held, seat, all);
    return paint(held);
  };
}
