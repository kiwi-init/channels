import { asOption } from "@kiwi/core/wake.ts";
import type { ChannelConfig, SeatTaken, SeatTook } from "../config.ts";
import { mcBin } from "./self.ts";

export function takenText(lost: readonly SeatTaken[], channels: Record<string, ChannelConfig>): string | null {
  const lines = lost.flatMap((t) => {
    const ch = channels[t.alias];
    if (!ch) return [];
    return [
      `Kiwi Channels: another session in \`${t.dir}\` took your seat as ${t.as} in ${t.alias}, so you no longer hear that channel and nothing wakes you for it. To take it back, run \`${mcBin()} join ${ch.code} ${asOption(t.as)}\` from \`${t.dir}\`.`,
    ];
  });
  return lines.length ? lines.join("\n") : null;
}

function quietFor(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours >= 1 ? `${hours}h${minutes ? ` ${minutes}m` : ""}` : `${minutes}m`;
}

export function tookText(took: readonly SeatTook[]): string | null {
  const lines = took.map((t) => `Kiwi Channels: this session took the seat as ${t.as} in ${t.alias} from session ${t.from}, quiet for ${quietFor(t.quiet)}; that channel's wakes come to you now.`);
  return lines.length ? lines.join("\n") : null;
}
