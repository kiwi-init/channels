export type StartupMark =
  | "main"
  | "store"
  | "window"
  | "webview"
  | "rules"
  | "canary"
  | "load"
  | "life"
  | "updates"
  | "willNavigate"
  | "committed"
  | "domReady"
  | "uiReady"
  | "keysAsk"
  | "keysReply"
  | "tray";

export type StartupMarks = Partial<Record<StartupMark | "bun", number>>;

const marks: StartupMarks = { bun: performance.timeOrigin };

export function mark(name: StartupMark): void {
  marks[name] ??= performance.timeOrigin + performance.now();
}

export const startupMarks = (): StartupMarks => ({ ...marks });

export function startupLine(all: StartupMarks): string {
  const from = all.bun;
  if (from === undefined) return "startup: no marks";
  const order = Object.entries(all)
    .filter((e): e is [string, number] => typeof e[1] === "number")
    .sort((a, b) => a[1] - b[1]);
  return `startup, ms since Bun started: ${order.map(([name, at]) => `${name} ${Math.round(at - from)}`).join(", ")}`;
}
