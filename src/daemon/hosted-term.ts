import { HOSTED_SESSION, type HostedTmux } from "./hosted-tmux.ts";

const BACKSLASH = 0x5c;
const SPACE = 0x20;
const OUTPUT = new TextEncoder().encode("%output ");
const EXTENDED = new TextEncoder().encode("%extended-output ");
const PANE = /^%\d{1,10}$/;
const HEX_CHUNK = 256;
const SEED_HISTORY = 2_000;
const PANE_FORMAT = "#{session_name}\t#{window_id}\t#{pane_width}\t#{pane_height}\t#{cursor_x}\t#{cursor_y}\t#{cursor_flag}\t#{alternate_on}\t#{pane_dead}";

export const TERM_COLS: readonly [number, number] = [20, 400];
export const TERM_ROWS: readonly [number, number] = [5, 200];

export interface PaneOutput {
  pane: string;
  data: Uint8Array;
}

export interface PaneInfo {
  window: string;
  cols: number;
  rows: number;
  cursor: { x: number; y: number; shown: boolean };
  alternate: boolean;
  dead: boolean;
}

interface TermOpened {
  window: string;
  cols: number;
  rows: number;
  seed: string;
  dead: boolean;
}

export type TermSend = (msg: { out: string } | { ended: true }) => boolean;

export const isPane = (v: unknown): v is string => typeof v === "string" && PANE.test(v);

const isOctal = (b: number | undefined): b is number => b !== undefined && b >= 0x30 && b <= 0x37;

export function unescapeOutput(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    const [x, y, z] = [bytes[i + 1], bytes[i + 2], bytes[i + 3]];
    if (b === BACKSLASH && isOctal(x) && isOctal(y) && isOctal(z)) {
      out[n++] = ((x - 0x30) << 6) | ((y - 0x30) << 3) | (z - 0x30);
      i += 3;
    } else out[n++] = b;
  }
  return out.subarray(0, n);
}

const startsWith = (line: Uint8Array, prefix: Uint8Array): boolean => line.length >= prefix.length && prefix.every((b, i) => line[i] === b);

const ascii = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

export function controlOutput(line: Uint8Array): PaneOutput | null {
  const extended = startsWith(line, EXTENDED);
  if (!extended && !startsWith(line, OUTPUT)) return null;
  const from = extended ? EXTENDED.length : OUTPUT.length;
  const space = line.indexOf(SPACE, from);
  if (space < 0) return null;
  const pane = ascii(line.subarray(from, space));
  if (!PANE.test(pane)) return null;
  if (!extended) return { pane, data: unescapeOutput(line.subarray(space + 1)) };
  for (let i = space + 1; i + 2 < line.length; i++) if (line[i] === SPACE && line[i + 1] === 0x3a && line[i + 2] === SPACE) return { pane, data: unescapeOutput(line.subarray(i + 3)) };
  return null;
}

const hex = (bytes: Uint8Array): string[] => Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));

export function keyCommands(pane: string, text: string): string[] {
  const cmds: string[] = [];
  let plain = "";
  const flush = (): void => {
    if (!plain) return;
    const bytes = hex(new TextEncoder().encode(plain));
    for (let i = 0; i < bytes.length; i += HEX_CHUNK) cmds.push(`send-keys -t ${pane} -H ${bytes.slice(i, i + HEX_CHUNK).join(" ")}`);
    plain = "";
  };
  for (const run of text.match(/[\x00-\x7f]+|[^\x00-\x7f]+/gu) ?? []) {
    if (run.charCodeAt(0) < 0x80) plain += run;
    else {
      flush();
      cmds.push(`send-keys -t ${pane} -l '${run}'`);
    }
  }
  flush();
  return cmds;
}

export const clampSize = (n: unknown, [lo, hi]: readonly [number, number]): number | null => (typeof n === "number" && Number.isInteger(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : null);

export function readPaneInfo(line: string): (PaneInfo & { session: string }) | null {
  const [session, window, w, h, x, y, cursor, alternate, dead] = line.trim().split("\t");
  const [cols, rows, cx, cy] = [w, h, x, y].map(Number);
  if (!session || !window || !cols || !rows || !Number.isInteger(cx) || !Number.isInteger(cy)) return null;
  return { session, window, cols, rows, cursor: { x: cx!, y: cy!, shown: cursor !== "0" }, alternate: alternate === "1", dead: dead === "1" };
}

export function seedOf(capture: string, info: PaneInfo): string {
  return [
    "\x1b[0m\x1b[H\x1b[2J\x1b[3J",
    info.alternate ? "\x1b[?1049h\x1b[H" : "",
    capture.replace(/\n$/, "").split("\n").join("\x1b[0m\r\n"),
    "\x1b[0m",
    `\x1b[${info.cursor.y + 1};${info.cursor.x + 1}H`,
    info.cursor.shown ? "\x1b[?25h" : "\x1b[?25l",
  ].join("");
}

async function paneInfo(hosted: HostedTmux, pane: string): Promise<PaneInfo | null> {
  const st = hosted.state();
  if (!st) return null;
  const r = await hosted.tmux(st, ["display-message", "-p", "-t", pane, PANE_FORMAT]);
  const info = r.status === 0 ? readPaneInfo(r.stdout) : null;
  return info && info.session === HOSTED_SESSION ? info : null;
}

export interface Term {
  opened: TermOpened;
  start: () => void;
  close: () => void;
}

export async function openTerm(hosted: HostedTmux, pane: string, cols: number, rows: number, send: TermSend): Promise<Term> {
  if (!PANE.test(pane)) throw new Error(`term needs a pane id like %3, not "${pane}"`);
  if (!(await hosted.resume())) throw new Error("Channels' own tmux isn't running on this computer");
  const before = await paneInfo(hosted, pane);
  if (!before) throw new Error(`pane ${pane} isn't one of Channels' own windows`);
  if (before.cols !== cols || before.rows !== rows) hosted.resize(pane, cols, rows);
  const held: Uint8Array[] = [];
  const decoder = new TextDecoder();
  let live = false;
  let closed = false;
  const forward = (data: Uint8Array): void => {
    const out = decoder.decode(data, { stream: true });
    if (out && !send({ out })) close();
  };
  const offOutput = hosted.output(pane, (data) => (live ? forward(data) : held.push(data)));
  const offGone = hosted.gone(pane, () => {
    send({ ended: true });
    close();
  });
  const close = (): void => {
    if (closed) return;
    closed = true;
    offOutput();
    offGone();
  };
  const start = (): void => {
    live = true;
    for (const data of held.splice(0)) if (!closed) forward(data);
  };
  try {
    const info = (await settled(hosted, pane, cols, rows, before)) ?? before;
    const st = hosted.state();
    if (!st) throw new Error("Channels' own tmux went away");
    const capture = await hosted.tmux(st, ["capture-pane", "-p", "-e", "-N", ...(info.alternate ? [] : ["-S", `-${SEED_HISTORY}`]), "-t", pane]);
    if (capture.status !== 0) throw new Error(`tmux wouldn't show pane ${pane}: ${capture.stderr.trim()}`);
    return { opened: { window: info.window, cols: info.cols, rows: info.rows, seed: seedOf(capture.stdout, info), dead: info.dead }, start, close };
  } catch (err) {
    close();
    throw err;
  }
}

async function settled(hosted: HostedTmux, pane: string, cols: number, rows: number, before: PaneInfo): Promise<PaneInfo | null> {
  if (before.cols === cols && before.rows === rows) return before;
  for (let i = 0; i < 20; i++) {
    const info = await paneInfo(hosted, pane);
    if (!info || (info.cols === cols && info.rows === rows)) return info;
    await Bun.sleep(25);
  }
  return paneInfo(hosted, pane);
}
