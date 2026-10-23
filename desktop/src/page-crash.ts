const CRASH_WINDOW_MS = 60_000;
const CRASHES_BEFORE_ASKING = 3;

export function afterCrash(recent: readonly number[], now: number): { reload: boolean; recent: number[] } {
  const kept = [...recent.filter((t) => now - t < CRASH_WINDOW_MS), now];
  return { reload: kept.length <= CRASHES_BEFORE_ASKING, recent: kept };
}
