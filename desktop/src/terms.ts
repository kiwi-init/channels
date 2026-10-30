import { randomUUID } from "node:crypto";
import net from "node:net";

import type { TermEvent, TermOpenView, TermTabView } from "./bridge.ts";
import { daemonMine, daemonMineClose, daemonMineTabs, daemonSocketPath, daemonToken, kiwiHome } from "./daemon-client.ts";

const FLUSH_MS = 8;
const OPEN_MS = 10_000;
const PANE = /^%\d{1,10}$/;
const ROOM_ID = /^[0-9a-f]{32}$/;

interface Open {
  conn: net.Socket;
  pane: string;
  next: number;
  token: string | null;
}

const open = new Map<string, Open>();

const size = (n: unknown): number => (typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 1_000 ? n : 0);

export function termOpen(pane: unknown, cols: unknown, rows: unknown, emit: (e: TermEvent) => void, home: string = kiwiHome()): Promise<TermOpenView> {
  if (typeof pane !== "string" || !PANE.test(pane) || !size(cols) || !size(rows)) return Promise.resolve({ ok: false, detail: "termOpen takes a pane like %3, and a size" });
  const term = randomUUID();
  const token = daemonToken(home);
  const conn = net.createConnection(daemonSocketPath(home));
  return new Promise((resolve) => {
    let answered = false;
    let buf = "";
    let pending = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = (): void => {
      timer = null;
      if (pending) emit({ term, out: pending });
      pending = "";
    };
    const answer = (view: TermOpenView): void => {
      if (answered) return;
      answered = true;
      clearTimeout(late);
      if (view.ok) open.set(term, { conn, pane, next: 2, token });
      else conn.destroy();
      resolve(view);
    };
    const late = setTimeout(() => answer({ ok: false, detail: "the daemon didn't open the terminal" }), OPEN_MS);
    const line = (raw: string): void => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // The daemon writes one JSON value per line; a line that isn't one carries nothing for the drawer.
        return;
      }
      if (msg.id !== 1) return;
      if (!answered) {
        const [c, r] = [size(msg.cols), size(msg.rows)];
        if (msg.ok === true && typeof msg.seed === "string" && typeof msg.window === "string" && c && r)
          answer({ ok: true, term, pane, window: msg.window, cols: c, rows: r, seed: msg.seed, dead: msg.dead === true });
        else answer({ ok: false, detail: typeof msg.error === "string" ? msg.error : "the daemon refused the terminal" });
        return;
      }
      if (typeof msg.out === "string") {
        pending += msg.out;
        timer ??= setTimeout(flush, FLUSH_MS);
      } else if (msg.ended === true) {
        flush();
        emit({ term, ended: true });
        termClose(term);
      }
    };
    conn.setEncoding("utf8");
    conn.on("connect", () => conn.write(`${JSON.stringify({ id: 1, verb: "term", pane, cols, rows, ...(token ? { token } : {}) })}\n`));
    conn.on("data", (chunk: string) => {
      buf += chunk;
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        line(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    });
    conn.on("error", (err) => answer({ ok: false, detail: err.message }));
    conn.on("close", () => {
      answer({ ok: false, detail: "the daemon closed the connection" });
      if (!open.delete(term)) return;
      if (timer) clearTimeout(timer);
      flush();
      emit({ term, ended: true });
    });
  });
}

export async function termMine(roomId: unknown, want: unknown, cols: unknown, rows: unknown, emit: (e: TermEvent) => void, home: string = kiwiHome()): Promise<TermOpenView> {
  if (typeof roomId !== "string" || !ROOM_ID.test(roomId)) return { ok: false, detail: "termMine takes a room id, a tab, and a size" };
  const tab = want === "new" || (typeof want === "string" && PANE.test(want)) ? want : null;
  const pane = await daemonMine(roomId, tab, home).catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))));
  return pane instanceof Error ? { ok: false, detail: pane.message } : termOpen(pane, cols, rows, emit, home);
}

export const termTabs = (home: string = kiwiHome()): Promise<TermTabView[]> => daemonMineTabs(home).catch(() => []);

export function termTabClose(pane: unknown, home: string = kiwiHome()): Promise<TermTabView[]> {
  return typeof pane === "string" && PANE.test(pane) ? daemonMineClose(pane, home).catch(() => []) : termTabs(home);
}

function send(term: unknown, verb: string, params: object): void {
  const t = typeof term === "string" ? open.get(term) : undefined;
  if (!t || t.conn.destroyed) return;
  t.conn.write(`${JSON.stringify({ ...params, id: t.next++, verb, pane: t.pane, ...(t.token ? { token: t.token } : {}) })}\n`);
}

export function termKeys(term: unknown, keys: unknown): void {
  if (typeof keys === "string" && keys.length > 0 && keys.length <= 65_536) send(term, "term-keys", { keys });
}

export function termSize(term: unknown, cols: unknown, rows: unknown): void {
  if (size(cols) && size(rows)) send(term, "term-size", { cols, rows });
}

export function termClose(term: unknown): void {
  const t = typeof term === "string" ? open.get(term) : undefined;
  if (!t) return;
  open.delete(term as string);
  t.conn.destroy();
}
