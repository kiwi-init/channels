export interface ShowGuard {
  shown(): boolean;
  show(): void;
  late(waited: number): void;
}

export function showWithin(ms: number, guard: ShowGuard): { waited: Promise<void>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const waited = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timer = null;
      if (!guard.shown()) {
        guard.late(ms);
        guard.show();
      }
      resolve();
    }, ms);
  });
  return {
    waited,
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
