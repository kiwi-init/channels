export interface WakeClock {
  now(): number;
  every(fn: () => void, ms: number): () => void;
}

const realClock: WakeClock = {
  now: () => Date.now(),
  every: (fn, ms) => {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  },
};

export const slept = (gapMs: number, everyMs: number, slackMs: number): boolean => gapMs > everyMs + slackMs;

export function watchWake(onWake: () => void, everyMs: number = 5000, slackMs: number = 15000, clock: WakeClock = realClock): () => void {
  let last = clock.now();
  return clock.every(() => {
    const now = clock.now();
    const gap = now - last;
    last = now;
    if (slept(gap, everyMs, slackMs)) onWake();
  }, everyMs);
}
