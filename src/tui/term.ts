// The terminal under `kiwi tui`: keys out of raw input, colours, and text measured and wrapped
// in columns. Nothing here knows about channels.

/** One key press (or one paste) out of raw input. */
export type Key = { name: "text"; text: string } | { name: "paste"; text: string } | { name: SimpleKey } | { name: "ctrl"; key: string };

type SimpleKey =
  | "return"
  | "newline"
  | "backspace"
  | "delete"
  | "tab"
  | "backtab"
  | "escape"
  | "up"
  | "down"
  | "left"
  | "right"
  | "home"
  | "end"
  | "pageup"
  | "pagedown"
  | "wordleft"
  | "wordright"
  | "wordback"
  | "worddelete";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

const CSI_KEYS: Record<string, SimpleKey> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
  Z: "backtab",
};
const TILDE_KEYS: Record<string, SimpleKey> = { "1": "home", "7": "home", "4": "end", "8": "end", "3": "delete", "5": "pageup", "6": "pagedown" };

/**
 * Turns raw input into keys. Escape sequences can arrive split across reads, and a paste
 * (bracketed, or a burst of text with line breaks from a terminal that doesn't bracket) is one key.
 */
export class KeyReader {
  private buf = "";
  private pasting: string | null = null;

  /** Feed a chunk; returns the keys it completes. A lone ESC waits for `flush` (it may start a sequence). */
  feed(chunk: string): Key[] {
    this.buf += chunk;
    const keys: Key[] = [];
    for (;;) {
      if (this.pasting !== null) {
        const end = this.buf.indexOf(PASTE_END);
        if (end < 0) {
          this.pasting += this.buf;
          this.buf = "";
          return keys;
        }
        keys.push({ name: "paste", text: normalizePaste(this.pasting + this.buf.slice(0, end)) });
        this.pasting = null;
        this.buf = this.buf.slice(end + PASTE_END.length);
        continue;
      }
      if (!this.buf) return keys;
      if (this.buf.startsWith(PASTE_START)) {
        this.pasting = "";
        this.buf = this.buf.slice(PASTE_START.length);
        continue;
      }
      const got = parseOne(this.buf, chunk.length > 1);
      if (!got) return keys;
      keys.push(got.key);
      this.buf = this.buf.slice(got.used);
    }
  }

  /** What's still held (a lone ESC, a cut-off sequence) once input goes quiet. */
  flush(): Key[] {
    if (this.pasting !== null || !this.buf) return [];
    const rest = this.buf;
    this.buf = "";
    return rest === "\x1b" ? [{ name: "escape" }] : rest.startsWith("\x1b") ? [] : this.feed(rest);
  }

  get pending(): boolean {
    return this.buf.length > 0 && this.pasting === null;
  }
}

function normalizePaste(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/\t/g, "  ");
}

/** The first key in `s`, and how many characters it used; null when `s` is a sequence cut short. */
function parseOne(s: string, burst: boolean): { key: Key; used: number } | null {
  const c = s[0]!;
  if (c === "\x1b") {
    if (s.length === 1) return null;
    const n = s[1]!;
    if (n === "[" || n === "O") {
      // CSI / SS3: parameters, then a final byte.
      const m = /^\x1b[[O]([0-9;]*)([A-Za-z~])/.exec(s);
      if (!m) return /^\x1b[[O][0-9;]*$/.test(s) ? null : { key: { name: "escape" }, used: 1 };
      const [all, params, final] = m as unknown as [string, string, string];
      const parts = params.split(";");
      const mod = Number(parts[1] ?? 1) - 1;
      const alt = (mod & 2) !== 0;
      const ctrl = (mod & 4) !== 0;
      if (final === "~") {
        const name = TILDE_KEYS[parts[0]!];
        return { key: name ? { name } : { name: "escape" }, used: all.length };
      }
      if (final === "u") {
        // CSI u (kitty, iTerm2 with it on): Shift/Alt+Enter is a new line.
        const code = Number(parts[0]);
        if (code === 13) return { key: { name: mod ? "newline" : "return" }, used: all.length };
        if (code === 27) return { key: { name: "escape" }, used: all.length };
        if (code === 127) return { key: { name: mod ? "wordback" : "backspace" }, used: all.length };
        if (code === 9) return { key: { name: mod & 1 ? "backtab" : "tab" }, used: all.length };
        if (ctrl && code >= 97 && code <= 122) return { key: { name: "ctrl", key: String.fromCharCode(code) }, used: all.length };
        if (code >= 32) return { key: { name: "text", text: String.fromCodePoint(code) }, used: all.length };
        return { key: { name: "escape" }, used: all.length };
      }
      const name = CSI_KEYS[final];
      if (!name) return { key: { name: "escape" }, used: all.length };
      if ((alt || ctrl) && name === "left") return { key: { name: "wordleft" }, used: all.length };
      if ((alt || ctrl) && name === "right") return { key: { name: "wordright" }, used: all.length };
      return { key: { name }, used: all.length };
    }
    // Alt (Option as Meta) + a key.
    if (n === "\r") return { key: { name: "newline" }, used: 2 };
    if (n === "\x7f" || n === "\b") return { key: { name: "wordback" }, used: 2 };
    if (n === "b") return { key: { name: "wordleft" }, used: 2 };
    if (n === "f") return { key: { name: "wordright" }, used: 2 };
    if (n === "d") return { key: { name: "worddelete" }, used: 2 };
    if (n === "\x1b") return { key: { name: "escape" }, used: 1 };
    return { key: { name: "escape" }, used: 1 };
  }
  if (c === "\r") return { key: { name: "return" }, used: s[1] === "\n" ? 2 : 1 };
  if (c === "\n") return { key: { name: "newline" }, used: 1 };
  if (c === "\x7f" || c === "\b") return { key: { name: "backspace" }, used: 1 };
  if (c === "\t") return { key: { name: "tab" }, used: 1 };
  const code = c.charCodeAt(0);
  if (code < 32) return { key: { name: "ctrl", key: String.fromCharCode(code + 96) }, used: 1 };
  // A burst of text with a line break inside, from a terminal that doesn't bracket pastes: a paste.
  if (burst) {
    const body = s.replace(/[\r\n]+$/, "");
    if (/[\r\n]/.test(body) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body)) return { key: { name: "paste", text: normalizePaste(body) }, used: s.length };
  }
  const run = /^[^\x00-\x1f\x7f]+/.exec(s)![0];
  return { key: { name: "text", text: run }, used: run.length };
}

// ---------- measuring text ----------

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Grapheme clusters: what the cursor steps over, and what wraps as a whole. */
export function graphemes(s: string): string[] {
  return Array.from(segmenter.segment(s), (x) => x.segment);
}

/** Columns a string takes, colour codes ignored. */
export function width(s: string): number {
  return Bun.stringWidth(s);
}

/** Strip colour codes. */
export function plain(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Wrap text to `cols`, breaking at spaces when it can and inside a word when it must. Line breaks
 * in the text are kept. Every line it returns fits.
 */
export function wrap(text: string, cols: number): string[] {
  const max = Math.max(1, cols);
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!para) {
      out.push("");
      continue;
    }
    let line = "";
    let w = 0;
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const ww = width(word);
      if (w + ww <= max) {
        line += word;
        w += ww;
        continue;
      }
      if (/^\s+$/.test(word)) {
        out.push(line);
        line = "";
        w = 0;
        continue;
      }
      if (line && ww <= max) {
        out.push(line.trimEnd());
        line = word;
        w = ww;
        continue;
      }
      for (const g of graphemes(word)) {
        const gw = width(g);
        if (w + gw > max && line) {
          out.push(line);
          line = "";
          w = 0;
        }
        line += g;
        w += gw;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Cut to at most `cols` columns, with an ellipsis when it had to cut. */
export function truncate(s: string, cols: number): string {
  if (width(s) <= cols) return s;
  let out = "";
  let w = 0;
  for (const g of graphemes(s)) {
    const gw = width(g);
    if (w + gw > cols - 1) break;
    out += g;
    w += gw;
  }
  return out + "…";
}

/** Pad with spaces to `cols` columns. */
export function pad(s: string, cols: number): string {
  return s + " ".repeat(Math.max(0, cols - width(s)));
}

// ---------- colour ----------

const noColor = () => !!process.env.NO_COLOR || process.env.TERM === "dumb";
const truecolor = () => /truecolor|24bit/i.test(process.env.COLORTERM ?? "");

/** The nearest of the 256 colours, for terminals without 24-bit colour. */
function to256(r: number, g: number, b: number): number {
  const q = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.floor((v - 35) / 40));
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

export type Style = (s: string) => string;

function sgr(on: string, off: string): Style {
  return (s) => (noColor() || !s ? s : `\x1b[${on}m${s}\x1b[${off}m`);
}

export function fg(hex: string): Style {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  return (s) => (noColor() || !s ? s : `\x1b[${truecolor() ? `38;2;${r};${g};${b}` : `38;5;${to256(r, g, b)}`}m${s}\x1b[39m`);
}

export function bg(hex: string): Style {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  return (s) => (noColor() || !s ? s : `\x1b[${truecolor() ? `48;2;${r};${g};${b}` : `48;5;${to256(r, g, b)}`}m${s}\x1b[49m`);
}

export const bold = sgr("1", "22");
export const dim = sgr("2", "22");
export const italic = sgr("3", "23");
export const inverse = sgr("7", "27");

/** Kiwi's indigo, and the few colours the screen speaks in. */
export const accent = fg("#8b87f5");
export const muted = fg("#8a8f98");
export const faint = fg("#5c616a");
export const good = fg("#4ade80");
export const warn = fg("#fbbf24");
export const bad = fg("#f87171");
export const code = fg("#c4b5fd");

/** A person's colour (one of the channel's ten), as the terminal shows it. */
export const MEMBER_COLORS: Record<string, string> = {
  red: "#f87171",
  orange: "#fb923c",
  yellow: "#facc15",
  green: "#4ade80",
  teal: "#2dd4bf",
  blue: "#60a5fa",
  indigo: "#818cf8",
  violet: "#a78bfa",
  pink: "#f472b6",
  brown: "#c08457",
};

// ---------- the screen ----------

export const ESC = {
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  pasteOn: "\x1b[?2004h",
  pasteOff: "\x1b[?2004l",
  syncOn: "\x1b[?2026h",
  syncOff: "\x1b[?2026l",
  clearBelow: "\x1b[J",
  clearScreen: "\x1b[2J\x1b[3J\x1b[H",
  up: (n: number) => (n > 0 ? `\x1b[${n}A` : ""),
  col: (n: number) => `\x1b[${n + 1}G`,
};
