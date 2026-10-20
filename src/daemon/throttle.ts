export interface Throttled {
  soon(): void;
  now(): Promise<void>;
}

export function throttled(run: () => Promise<void>, gapMs: number, clock: () => number = Date.now): Throttled {
  let running: Promise<void> | null = null;
  let doneAt = Number.NEGATIVE_INFINITY;
  const now = (): Promise<void> => {
    running ??= run()
      .catch(() => {})
      .finally(() => {
        running = null;
        doneAt = clock();
      });
    return running;
  };
  return {
    now,
    soon: () => {
      if (!running && clock() - doneAt >= gapMs) void now();
    },
  };
}
