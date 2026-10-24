import { readHookRow, type HookRow } from "./harnesses.ts";
import { isTerminalId, type TerminalId } from "./terminals.ts";

export type SeatWake = "on" | "off" | "webhook";

export interface SeatSettings {
  channel: string;
  agent: string;
  wake: SeatWake;
}

export interface ComputerSettings {
  launch: "on" | "off";
  bypass: "on" | "off";
  prefer: TerminalId;
  hooks: HookRow[];
  seats: SeatSettings[];
}

const SEATS_MAX = 100;
const NAME_MAX = 120;

const name = (v: unknown): string | null => (typeof v === "string" && v.length > 0 && v.length <= NAME_MAX ? v : null);

function readSeat(x: unknown): SeatSettings | null {
  if (!x || typeof x !== "object") return null;
  const s = x as Record<string, unknown>;
  const channel = name(s.channel);
  const agent = name(s.agent);
  if (!channel || !agent || (s.wake !== "on" && s.wake !== "off" && s.wake !== "webhook")) return null;
  return { channel, agent, wake: s.wake };
}

export function readComputerSettings(x: unknown): ComputerSettings | null {
  if (!x || typeof x !== "object") return null;
  const s = x as Record<string, unknown>;
  if ((s.launch !== "on" && s.launch !== "off") || !isTerminalId(s.prefer) || !Array.isArray(s.hooks) || !Array.isArray(s.seats)) return null;
  return {
    launch: s.launch,
    bypass: s.bypass === "on" ? "on" : "off",
    prefer: s.prefer,
    hooks: s.hooks.map(readHookRow).filter((h): h is HookRow => h !== null),
    seats: s.seats
      .slice(0, SEATS_MAX)
      .map(readSeat)
      .filter((seat): seat is SeatSettings => seat !== null),
  };
}
