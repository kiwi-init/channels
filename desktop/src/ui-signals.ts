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
