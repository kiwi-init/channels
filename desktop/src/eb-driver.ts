import fs from "node:fs";

export interface DriverAsk {
  id: number;
  fn: string;
  arg: string;
}

export type DriverAnswer = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

type Handler = (msg: unknown) => void;

export interface DrivenView {
  rpcHandler?: Handler;
  executeJavascript(js: string): void;
}

const TAG = "kiwiDriver";

export function driverAsk(line: string): DriverAsk | null {
  try {
    const v = JSON.parse(line) as unknown;
    if (!v || typeof v !== "object") return null;
    const { id, fn, arg } = v as Record<string, unknown>;
    return typeof id === "number" && typeof fn === "string" && typeof arg === "string" ? { id, fn, arg } : null;
  } catch {
    // A line that isn't JSON asks nothing: the driver answers only requests it can read.
    return null;
  }
}

export function pageScript(id: number, fn: string, arg: string): string {
  return [
    "(() => {",
    `const send = (a) => window.__electrobunHostBridge.postMessage(JSON.stringify({ ${TAG}: ${id}, ...a }));`,
    "const fail = (e) => send({ ok: false, error: String((e && e.stack) || e) });",
    `try { Promise.resolve((${fn})(JSON.parse(${JSON.stringify(arg)}))).then((value) => send({ ok: true, value: value === undefined ? null : value }), fail); } catch (e) { fail(e); }`,
    "})();",
  ].join("\n");
}

export function pageAnswer(msg: unknown): DriverAnswer | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  const id = m[TAG];
  if (typeof id !== "number" || typeof m.ok !== "boolean") return null;
  return m.ok ? { id, ok: true, value: m.value } : { id, ok: false, error: typeof m.error === "string" ? m.error : "the page's script failed" };
}

export function drive(view: DrivenView, socketPath: string): void {
  const waiting = new Map<number, (a: DriverAnswer) => void>();
  let next = 0;
  let inner: Handler | undefined = view.rpcHandler;
  const handler: Handler = (msg) => {
    const a = pageAnswer(msg);
    if (!a) return inner?.(msg);
    waiting.get(a.id)?.(a);
    waiting.delete(a.id);
  };
  Object.defineProperty(view, "rpcHandler", {
    configurable: true,
    get: () => handler,
    set: (h: Handler | undefined) => void (inner = h),
  });
  fs.rmSync(socketPath, { force: true });
  Bun.listen<{ buffered: string }>({
    unix: socketPath,
    socket: {
      open(socket) {
        socket.data = { buffered: "" };
      },
      data(socket, chunk) {
        const lines = (socket.data.buffered + chunk.toString("utf8")).split("\n");
        socket.data.buffered = lines.pop() ?? "";
        for (const line of lines) {
          const ask = driverAsk(line);
          if (!ask) continue;
          const id = ++next;
          waiting.set(id, (a) => void socket.write(`${JSON.stringify({ ...a, id: ask.id })}\n`));
          view.executeJavascript(pageScript(id, ask.fn, ask.arg));
        }
      },
    },
  });
}
