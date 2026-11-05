import { asOption } from "@kiwi/core/wake.ts";
import type { ChannelConfig, SeatTaken } from "../config.ts";
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
