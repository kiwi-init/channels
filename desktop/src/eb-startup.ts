export type StartupMark = "main" | "window" | "webview" | "load" | "tray";

export type StartupMarks = Partial<Record<StartupMark | "bun", number>>;

const marks: StartupMarks = { bun: performance.timeOrigin };

export function mark(name: StartupMark): void {
  marks[name] ??= performance.timeOrigin + performance.now();
}

export const startupMarks = (): StartupMarks => ({ ...marks });
