import type { UiUpdateView } from "./bridge.ts";

export interface UiSignals {
  ready(): void;
  error(message: string): void;
}

let heard: UiSignals | null = null;

export const hearUi = (signals: UiSignals): void => void (heard = signals);

export const uiSignals: UiSignals = {
  ready: () => heard?.ready(),
  error: (message) => heard?.error(message),
};

let waiting: UiUpdateView | null = null;
let apply: (() => void) | null = null;
const listeners = new Set<(u: UiUpdateView | null) => void>();

export const uiWaiting = (): UiUpdateView | null => waiting;

export function setUiWaiting(next: UiUpdateView | null): void {
  waiting = next;
  for (const l of listeners) l(next);
}

export const onUiWaiting = (cb: (u: UiUpdateView | null) => void): (() => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

export const hearApply = (fn: () => void): void => void (apply = fn);

export const applyWaitingUi = (): void => apply?.();
