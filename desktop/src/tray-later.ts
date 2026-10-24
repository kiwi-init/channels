export const TRAY_AFTER_READY_MS = 2_000;
export const TRAY_LATEST_MS = 10_000;

export interface Refreshing<U> {
  refresh(update: U): void;
}

export interface TrayLater<U> {
  make: (update: U) => Refreshing<U>;
  update: U;
  onReady: (f: () => void) => void;
  later: (f: () => void, ms: number) => void;
}

export function trayLater<U>({ make, update, onReady, later }: TrayLater<U>): Refreshing<U> {
  let tray: Refreshing<U> | null = null;
  let latest = update;
  const once = (): void => void (tray ??= make(latest));
  onReady(() => later(once, TRAY_AFTER_READY_MS));
  later(once, TRAY_LATEST_MS);
  return {
    refresh: (u) => {
      latest = u;
      tray?.refresh(u);
    },
  };
}
