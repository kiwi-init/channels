import type { RexActivity, RexPlace } from "../rex.ts";

const REX_READ_GAP_MS = 1_000;

export interface RexReadSeat {
  rexBlock?: string;
  rexActivity?: RexActivity | null;
  rexReading?: boolean;
  rexReadAt?: number;
}

export function readRexInto(seat: RexReadSeat, place: RexPlace, read: (place: RexPlace) => Promise<RexActivity | null>, changed: () => void, now = Date.now(), gapMs = REX_READ_GAP_MS): boolean {
  if (seat.rexReading || (seat.rexReadAt !== undefined && now - seat.rexReadAt < gapMs)) return false;
  seat.rexReading = true;
  seat.rexReadAt = now;
  void read(place)
    .catch(() => null)
    .then((got) => {
      seat.rexReading = false;
      if (seat.rexBlock !== place.block || JSON.stringify(got) === JSON.stringify(seat.rexActivity)) return;
      seat.rexActivity = got;
      changed();
    });
  return true;
}
