import { signRequest } from "@kiwi/core/auth.ts";
import type { Identity } from "@kiwi/core/identity.ts";
import type { ShellAsk } from "@kiwi/core/machine-ask.ts";
import { newShellKey, openPipe, textChunks, type Pipe } from "@kiwi/core/pipe.ts";
import { PING, WS_PROTOCOL } from "@kiwi/core/protocol.ts";
import { clampSize, TERM_COLS, TERM_ROWS, type Term, type TermSend } from "./hosted-term.ts";
import type { MineTab } from "./hosted-tmux.ts";

export const REMOTE_SHELLS = 4;
export const SHELL_OPENS_PER_MINUTE = 10;
const PAIRED = JSON.stringify({ paired: true });
const CONNECT_MS = 10_000;
const FLUSH_MS = 16;

const NO_REMOTE_SHELLS = "this computer doesn't open shells for your other devices: run kiwi shells on there to allow it";

export type ShellResult =
  | { ok: true; epk: string; pane: string; window: string; cols: number; rows: number }
  | { ok: true; tabs: MineTab[] }
  | { ok: false; why: "not-allowed" | "failed"; detail: string };

export interface ShellDeps {
  machine: () => { identity: Identity; relay: string } | null;
  on: () => boolean;
  mine: (want: string) => Promise<{ ok: true; pane: string } | { ok: false; detail: string }>;
  term: (pane: string, cols: number, rows: number, send: TermSend) => Promise<Term>;
  keys: (pane: string, text: string) => boolean;
  resize: (pane: string, cols: number, rows: number) => boolean;
  tabs: () => Promise<MineTab[]>;
  closeTab: (pane: string) => Promise<MineTab[]>;
  yours: (by: string) => Promise<boolean>;
  log: (row: string[]) => void;
  now?: () => number;
  pairMs?: number;
  pingMs?: number;
}

interface Open {
  by: string;
  pane: string;
  end: (why: string) => void;
}

export interface RemoteShells {
  open(ask: ShellAsk, id: string, by: string): Promise<ShellResult>;
  tabs(): Promise<ShellResult>;
  close(pane: string): Promise<ShellResult>;
  recheck(): Promise<void>;
  count(): number;
  stop(): void;
}

function connect(url: string, token: string, ms: number): Promise<WebSocket | null> {
  const ws = new WebSocket(url, [WS_PROTOCOL, token]);
  ws.binaryType = "arraybuffer";
  return new Promise((resolve) => {
    const late = setTimeout(() => {
      ws.close();
      resolve(null);
    }, ms);
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

export function remoteShells(deps: ShellDeps): RemoteShells {
  const now = deps.now ?? Date.now;
  const open = new Set<Open>();
  const opens: number[] = [];

  const refuse = (why: "not-allowed" | "failed", detail: string): ShellResult => ({ ok: false, why, detail });

  const start = async (ask: ShellAsk, id: string, by: string): Promise<ShellResult> => {
    const m = deps.machine();
    if (!m?.relay) return refuse("failed", "this computer isn't signed in to a relay");
    const cols = clampSize(ask.cols, TERM_COLS)!;
    const rows = clampSize(ask.rows, TERM_ROWS)!;
    const mine = await deps.mine(ask.want);
    if (!mine.ok) return refuse("failed", mine.detail);
    const pane = mine.pane;
    const key = await newShellKey();
    const pipe: Pipe = await openPipe(key, "computer", { pipe: ask.pipe, ask: id, machine: m.identity.pk, app: ask.epk, computer: key.epk });
    const path = `/v1/machine/${m.identity.pk}/pipe/${ask.pipe}`;
    const token = await signRequest(m.identity, `machine:${m.identity.pk}`, "GET", path);
    const ws = await connect(`${m.relay.replace(/\/+$/, "").replace(/^http/, "ws")}${path}`, token, CONNECT_MS);
    if (!ws) return refuse("failed", "this computer couldn't reach the relay for the shell");

    let ended = false;
    let paired = false;
    let pending = "";
    let flushing: ReturnType<typeof setTimeout> | null = null;
    let term: Term | null = null;
    const sendFrame = (msg: { out: string } | { ended: true }): void => {
      void pipe
        .seal(msg)
        .then((f) => ws.readyState === WebSocket.OPEN && ws.send(f))
        .catch(() => end("a frame wouldn't seal"));
    };
    const flush = (): void => {
      flushing = null;
      for (const chunk of textChunks(pending)) sendFrame({ out: chunk });
      pending = "";
    };
    const self: Open = { by, pane, end: (why) => end(why) };
    const pairLate = setTimeout(() => !paired && end("your device didn't join the shell"), deps.pairMs ?? 30_000);
    const ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(PING), deps.pingMs ?? 30_000);
    const end = (why: string): void => {
      if (ended) return;
      ended = true;
      open.delete(self);
      clearTimeout(pairLate);
      clearInterval(ping);
      if (flushing) clearTimeout(flushing);
      term?.close();
      try {
        ws.close(1000, "the shell's pipe closed");
      } catch {
        // Already closed by the relay or the other side.
      }
      deps.log(["shell", "closed", pane, by, why]);
    };
    const send: TermSend = (msg) => {
      if (ended) return false;
      if ("out" in msg) {
        pending += msg.out;
        flushing ??= setTimeout(flush, FLUSH_MS);
        return true;
      }
      if (flushing) clearTimeout(flushing);
      flush();
      sendFrame({ ended: true });
      setTimeout(() => end("the shell exited"), FLUSH_MS);
      return true;
    };
    ws.onclose = () => end("the pipe closed");
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        if (e.data !== PAIRED || paired || !term) return;
        paired = true;
        clearTimeout(pairLate);
        for (const chunk of textChunks(term.opened.seed)) sendFrame({ out: chunk });
        term.start();
        return;
      }
      void pipe.open(new Uint8Array(e.data as ArrayBuffer)).then((msg) => {
        if (ended) return;
        if (!msg) return end("a frame from your device didn't open");
        if ("keys" in msg) deps.keys(pane, msg.keys);
        else if ("size" in msg) deps.resize(pane, clampSize(msg.size.cols, TERM_COLS)!, clampSize(msg.size.rows, TERM_ROWS)!);
        else if ("close" in msg) end("your device closed it");
      });
    };
    try {
      term = await deps.term(pane, cols, rows, send);
    } catch (err) {
      end("the pane wouldn't open");
      return refuse("failed", err instanceof Error ? err.message : String(err));
    }
    if (ended) return refuse("failed", "the shell's pipe closed before it opened");
    open.add(self);
    deps.log(["shell", "opened", pane, by]);
    return { ok: true, epk: key.epk, pane, window: term.opened.window, cols: term.opened.cols, rows: term.opened.rows };
  };

  return {
    async open(ask, id, by) {
      if (!deps.on()) return refuse("not-allowed", NO_REMOTE_SHELLS);
      if (open.size >= REMOTE_SHELLS) return refuse("failed", `at most ${REMOTE_SHELLS} shells are open here from your other devices`);
      const at = now();
      while (opens.length && at - opens[0]! >= 60_000) opens.shift();
      if (opens.length >= SHELL_OPENS_PER_MINUTE) return refuse("failed", `at most ${SHELL_OPENS_PER_MINUTE} shells open here each minute`);
      opens.push(at);
      return start(ask, id, by);
    },
    async tabs() {
      if (!deps.on()) return refuse("not-allowed", NO_REMOTE_SHELLS);
      return { ok: true, tabs: await deps.tabs() };
    },
    async close(pane) {
      if (!deps.on()) return refuse("not-allowed", NO_REMOTE_SHELLS);
      for (const o of [...open]) if (o.pane === pane) o.end("closed from your device");
      return { ok: true, tabs: await deps.closeTab(pane) };
    },
    async recheck() {
      for (const o of [...open]) if (!(await deps.yours(o.by))) o.end("the device that opened it was removed");
      if (!deps.on()) for (const o of [...open]) o.end("shells were turned off here");
    },
    count: () => open.size,
    stop() {
      for (const o of [...open]) o.end("kiwi stopped");
    },
  };
}
