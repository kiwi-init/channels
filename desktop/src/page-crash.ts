const CRASH_WINDOW_MS = 60_000;
const CRASHES_BEFORE_ASKING = 3;

export function afterCrash(recent: readonly number[], now: number): { reload: boolean; recent: number[] } {
  const kept = [...recent.filter((t) => now - t < CRASH_WINDOW_MS), now];
  return { reload: kept.length <= CRASHES_BEFORE_ASKING, recent: kept };
}

export interface PageKeeper {
  reload(): void;
  ask(message: string, buttons: [string, string]): Promise<boolean>;
  quit(): void;
  log(err: Error): void;
  quitting(): boolean;
  now(): number;
}

export function keepPageAlive(k: PageKeeper): (why: string) => void {
  let recent: number[] = [];
  let asking = false;
  return (why) => {
    if (k.quitting()) return;
    const next = afterCrash(recent, k.now());
    recent = next.recent;
    k.log(new Error(`the window's page stopped (${why})`));
    if (next.reload) return k.reload();
    if (asking) return;
    asking = true;
    void k
      .ask("Channels' window keeps stopping.", ["Quit", "Reload"])
      .then((reload) => (reload ? k.reload() : k.quit()))
      .finally(() => (asking = false));
  };
}
