import { signRequest } from "@kiwi/core/auth.ts";
import { b64url } from "@kiwi/core/crypto.ts";
import { readShellOpened, readShellTabs } from "@kiwi/core/machine-ask.ts";
import { newShellKey, openPipe, textChunks, type Pipe } from "@kiwi/core/pipe.ts";
import { PING, WS_PROTOCOL } from "@kiwi/core/protocol.ts";
import type { TermEvent, TermOpenView, TermTabView } from "./bridge.ts";
import { askMachine, type Asked, type Asker } from "./remote.ts";

const PANE = /^%\d{1,10}$/;
const OPEN_MS = 15_000;
const TABS_MS = 10_000;
const CONNECT_MS = 10_000;
const PING_MS = 30_000;

interface Machine {
  pk: string;
  xpk: string;
}

interface Remote {
  ws: WebSocket;
  pipe: Pipe;
  close: () => void;
}

const remote = new Map<string, Remote>();

const size = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 1_000;

const id = (): string => b64url(crypto.getRandomValues(new Uint8Array(16)));

function refused(asked: Asked): string {
  if (!asked.ok) return asked.detail;
  const r = asked.result && typeof asked.result === "object" ? (asked.result as { detail?: unknown }).detail : undefined;
  return typeof r === "string" ? r : "that computer answered in a shape this app doesn't know";
}

function connect(url: string, token: string): Promise<WebSocket | null> {
  const ws = new WebSocket(url, [WS_PROTOCOL, token]);
  ws.binaryType = "arraybuffer";
  return new Promise((resolve) => {
    const late = setTimeout(() => {
      ws.close();
      resolve(null);
    }, CONNECT_MS);
    ws.onopen = () => {
      clearTimeout(late);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(late);
      resolve(null);
    };
  });
}

export async function termRemote(asker: Asker, machine: Machine, want: unknown, cols: unknown, rows: unknown, emit: (e: TermEvent) => void): Promise<TermOpenView> {
  const tab = want === "new" || (typeof want === "string" && PANE.test(want)) ? want : want === null ? "any" : null;
  if (!tab || !size(cols) || !size(rows)) return { ok: false, detail: "termRemote takes a computer, a tab, and a size" };
  const key = await newShellKey();
  const pipeId = id();
  const askId = id();
  const asked = await askMachine(asker, machine, "shell", { want: tab, cols, rows, pipe: pipeId, epk: key.epk }, { timeoutMs: OPEN_MS, id: askId });
  const opened = asked.ok ? readShellOpened(asked.result) : null;
  if (!opened) return { ok: false, detail: refused(asked) };
  const pipe = await openPipe(key, "app", { pipe: pipeId, ask: askId, machine: machine.pk, app: key.epk, computer: opened.epk });
  const path = `/v1/machine/${machine.pk}/pipe/${pipeId}`;
  const token = await signRequest(asker.signer, `machine:${machine.pk}`, "GET", path);
  const ws = await connect(new URL(path, asker.relay).toString().replace(/^http/, "ws"), token);
  if (!ws) return { ok: false, detail: "couldn't reach the relay for the shell" };

  const term = id();
  let ready = false;
  let ended = false;
  const held: TermEvent[] = [];
  const say = (e: TermEvent): void => (ready ? emit(e) : void held.push(e));
  const ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(PING), PING_MS);
  const done = (): void => {
    clearInterval(ping);
    remote.delete(term);
  };
  const finish = (e: TermEvent): void => {
    if (ended) return;
    ended = true;
    done();
    say(e);
    try {
      ws.close(1000);
    } catch {
      // Already closed by the relay or the computer.
    }
  };
  ws.onmessage = (e) => {
    if (typeof e.data === "string") return;
    void pipe.open(new Uint8Array(e.data as ArrayBuffer)).then((msg) => {
      if (ended) return;
      if (!msg) return finish({ term, lost: true });
      if ("out" in msg) say({ term, out: msg.out });
      else if ("ended" in msg) finish({ term, ended: true });
    });
  };
  ws.onclose = () => finish({ term, lost: true });
  const close = (): void => {
    if (ended) return;
    ended = true;
    done();
    void pipe
      .seal({ close: true })
      .then((f) => ws.readyState === WebSocket.OPEN && ws.send(f))
      .catch(() => undefined)
      .finally(() => setTimeout(() => ws.close(1000), 50));
  };
  remote.set(term, { ws, pipe, close });
  setTimeout(() => {
    ready = true;
    for (const e of held.splice(0)) emit(e);
  }, 0);
  return { ok: true, term, pane: opened.pane, window: opened.window, cols: opened.cols, rows: opened.rows, seed: "", dead: false };
}

function send(term: unknown, msgs: ({ keys: string } | { size: { cols: number; rows: number } } | { close: true })[]): boolean {
  const r = typeof term === "string" ? remote.get(term) : undefined;
  if (!r) return false;
  for (const msg of msgs) void r.pipe.seal(msg).then((f) => r.ws.readyState === WebSocket.OPEN && r.ws.send(f));
  return true;
}

export const isRemoteTerm = (term: unknown): boolean => typeof term === "string" && remote.has(term);

export function remoteKeys(term: unknown, keys: unknown): boolean {
  if (typeof keys !== "string" || keys.length === 0 || keys.length > 65_536) return isRemoteTerm(term);
  return send(
    term,
    textChunks(keys).map((k) => ({ keys: k })),
  );
}

export function remoteSize(term: unknown, cols: unknown, rows: unknown): boolean {
  if (!size(cols) || !size(rows)) return isRemoteTerm(term);
  return send(term, [{ size: { cols, rows } }]);
}

export function remoteClose(term: unknown): boolean {
  const r = typeof term === "string" ? remote.get(term) : undefined;
  r?.close();
  return !!r;
}

export async function remoteTabs(asker: Asker, machine: Machine): Promise<TermTabView[]> {
  const asked = await askMachine(asker, machine, "shell-tabs", {}, { timeoutMs: TABS_MS });
  return (asked.ok ? readShellTabs(asked.result) : null) ?? [];
}

export async function remoteTabClose(asker: Asker, machine: Machine, pane: unknown): Promise<TermTabView[]> {
  if (typeof pane !== "string" || !PANE.test(pane)) return remoteTabs(asker, machine);
  const asked = await askMachine(asker, machine, "shell-close", { pane }, { timeoutMs: TABS_MS });
  return (asked.ok ? readShellTabs(asked.result) : null) ?? [];
}
