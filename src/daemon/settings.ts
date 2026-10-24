import type { ComputerSettings, SeatSettings } from "@kiwi/core/computer-settings.ts";
import type { HookRow } from "@kiwi/core/harnesses.ts";
import { wakeKey } from "@kiwi/core/wake.ts";
import { allSeats, type Config } from "../config.ts";
import { launchesOn, preferred } from "../terminals/registry.ts";

export function computerSettings(cfg: Config, hooks: HookRow[]): ComputerSettings {
  const seats = new Map<string, SeatSettings>();
  for (const seat of allSeats(cfg)) {
    const channel = cfg.channels[seat.alias];
    const key = wakeKey(seat.alias, seat.as);
    if (!channel || seats.has(key)) continue;
    const wake = cfg.wakeHooks?.[key] ? "webhook" : cfg.wakeOff?.includes(key) ? "off" : "on";
    seats.set(key, { channel: channel.title ?? seat.alias, agent: seat.as, wake });
  }
  return { launch: launchesOn(cfg) ? "on" : "off", prefer: preferred(cfg), hooks, seats: [...seats.values()] };
}
