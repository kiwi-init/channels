import fs from "node:fs";
import path from "node:path";

export type DriverAsk = { id: number; fn: string; arg: string } | { id: number; main: string };

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
    const { id, fn, arg, main } = v as Record<string, unknown>;
    if (typeof id !== "number") return null;
    if (typeof main === "string") return { id, main };
    return typeof fn === "string" && typeof arg === "string" ? { id, fn, arg } : null;
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

export function driverSocketProblem(socketPath: string, uid: number = process.getuid?.() ?? -1): string | null {
  if (!path.isAbsolute(socketPath)) return `${socketPath} isn't an absolute path`;
  let dir: fs.Stats;
  try {
    dir = fs.statSync(path.dirname(socketPath));
  } catch {
    // A folder that isn't there can't be a private one: the driver doesn't make it.
    return `${path.dirname(socketPath)} doesn't exist`;
  }
  if (!dir.isDirectory() || dir.uid !== uid || (dir.mode & 0o077) !== 0) return `${path.dirname(socketPath)} isn't a folder only this user can open (0700)`;
  let there: fs.Stats | null;
  try {
    there = fs.lstatSync(socketPath);
  } catch {
    // Nothing at the path yet: the driver makes its socket there.
    there = null;
  }
  return there && !there.isSocket() ? `${socketPath} is there and isn't a socket, so the driver won't remove it` : null;
}

export function mainAnswer(ask: { id: number; main: string }, answers: Readonly<Record<string, () => unknown>>): DriverAnswer {
  const answer = Object.hasOwn(answers, ask.main) ? answers[ask.main] : undefined;
  return answer ? { id: ask.id, ok: true, value: answer() } : { id: ask.id, ok: false, error: `main answers no ${ask.main}` };
}

export function drive(view: DrivenView, socketPath: string, answers: Readonly<Record<string, () => unknown>> = {}): void {
  const wrong = driverSocketProblem(socketPath);
  if (wrong) throw new Error(`the test driver won't listen: ${wrong}`);
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
  process.on("exit", () => fs.rmSync(socketPath, { force: true }));
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
          if ("main" in ask) {
            socket.write(`${JSON.stringify(mainAnswer(ask, answers))}\n`);
            continue;
          }
          const id = ++next;
          waiting.set(id, (a) => void socket.write(`${JSON.stringify({ ...a, id: ask.id })}\n`));
          view.executeJavascript(pageScript(id, ask.fn, ask.arg));
        }
      },
    },
  });
}
