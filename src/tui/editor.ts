// The prompt's text and cursor, and what each editing key does to them. Pure: the screen draws
// whatever this holds, so it's tested without a terminal.

import { graphemes, width } from "./term.ts";

export interface Draft {
  text: string;
  /** An index into `text`, always on a grapheme boundary. */
  cursor: number;
}

export const empty = (): Draft => ({ text: "", cursor: 0 });

/** Grapheme boundaries of `s`, 0 and s.length included. */
function stops(s: string): number[] {
  const out = [0];
  let at = 0;
  for (const g of graphemes(s)) out.push((at += g.length));
  return out;
}

const prevStop = (s: string, i: number) => stops(s).filter((x) => x < i).at(-1) ?? 0;
const nextStop = (s: string, i: number) => stops(s).find((x) => x > i) ?? s.length;

export function insert(d: Draft, text: string): Draft {
  return { text: d.text.slice(0, d.cursor) + text + d.text.slice(d.cursor), cursor: d.cursor + text.length };
}

export function backspace(d: Draft): Draft {
  if (!d.cursor) return d;
  const at = prevStop(d.text, d.cursor);
  return { text: d.text.slice(0, at) + d.text.slice(d.cursor), cursor: at };
}

export function del(d: Draft): Draft {
  if (d.cursor >= d.text.length) return d;
  return { text: d.text.slice(0, d.cursor) + d.text.slice(nextStop(d.text, d.cursor)), cursor: d.cursor };
}

export const left = (d: Draft): Draft => ({ ...d, cursor: prevStop(d.text, d.cursor) });
export const right = (d: Draft): Draft => ({ ...d, cursor: nextStop(d.text, d.cursor) });

const lineStart = (s: string, i: number) => s.lastIndexOf("\n", i - 1) + 1;
const lineEnd = (s: string, i: number) => (s.indexOf("\n", i) < 0 ? s.length : s.indexOf("\n", i));

export const home = (d: Draft): Draft => ({ ...d, cursor: lineStart(d.text, d.cursor) });
export const end = (d: Draft): Draft => ({ ...d, cursor: lineEnd(d.text, d.cursor) });

function wordLeftOf(s: string, i: number): number {
  let j = i;
  while (j > 0 && /\s/.test(s[j - 1]!)) j--;
  while (j > 0 && !/\s/.test(s[j - 1]!)) j--;
  return j;
}

function wordRightOf(s: string, i: number): number {
  let j = i;
  while (j < s.length && /\s/.test(s[j]!)) j++;
  while (j < s.length && !/\s/.test(s[j]!)) j++;
  return j;
}

export const wordLeft = (d: Draft): Draft => ({ ...d, cursor: wordLeftOf(d.text, d.cursor) });
export const wordRight = (d: Draft): Draft => ({ ...d, cursor: wordRightOf(d.text, d.cursor) });

/** Ctrl+W, Alt+Backspace: the word before the cursor. */
export function deleteWordBack(d: Draft): Draft {
  const at = wordLeftOf(d.text, d.cursor);
  return { text: d.text.slice(0, at) + d.text.slice(d.cursor), cursor: at };
}

/** Alt+D: the word after the cursor. */
export function deleteWordForward(d: Draft): Draft {
  const to = wordRightOf(d.text, d.cursor);
  return { text: d.text.slice(0, d.cursor) + d.text.slice(to), cursor: d.cursor };
}

/** Ctrl+U: back to the start of the line (or join it to the line above, at its start). */
export function killToStart(d: Draft): Draft {
  const at = lineStart(d.text, d.cursor);
  const from = at === d.cursor && at > 0 ? at - 1 : at;
  return { text: d.text.slice(0, from) + d.text.slice(d.cursor), cursor: from };
}

/** Ctrl+K: to the end of the line (or the line break, at its end). */
export function killToEnd(d: Draft): Draft {
  const to = lineEnd(d.text, d.cursor);
  return { text: d.text.slice(0, d.cursor) + d.text.slice(to === d.cursor ? to + 1 : to), cursor: d.cursor };
}

// ---------- layout ----------

export interface Layout {
  /** Visual lines, each at most `cols` wide. */
  lines: string[];
  /** Where each visual line starts in the text. */
  starts: number[];
  /** Where the cursor lands: a visual line and a column in it. */
  row: number;
  col: number;
}

/**
 * The draft as it shows in a box `cols` wide: line breaks kept, long lines cut at the edge (by
 * grapheme, so the cursor maps exactly), and where the cursor is.
 */
export function layout(d: Draft, cols: number): Layout {
  const max = Math.max(2, cols);
  const lines: string[] = [];
  const starts: number[] = [];
  let row = 0;
  let col = 0;
  let at = 0;
  const logical = d.text.split("\n");
  logical.forEach((text, li) => {
    let line = "";
    let w = 0;
    starts.push(at);
    const place = () => {
      if (d.cursor === at) {
        row = lines.length;
        col = w;
      }
    };
    for (const g of graphemes(text)) {
      const gw = width(g);
      // One column stays free at the edge, for the cursor after the last character.
      if (w + gw > max - 1 && w > 0) {
        lines.push(line);
        starts.push(at);
        line = "";
        w = 0;
      }
      place();
      line += g;
      w += gw;
      at += g.length;
    }
    place();
    lines.push(line);
    if (li < logical.length - 1) at += 1;
  });
  return { lines, starts, row, col };
}

/** Up/Down inside a draft of several lines: the same column on the visual line above or below, if there is one. */
export function vertical(d: Draft, cols: number, dir: -1 | 1): Draft | null {
  const { lines, starts, row, col } = layout(d, cols);
  const target = row + dir;
  if (target < 0 || target >= lines.length) return null;
  let at = starts[target]!;
  let w = 0;
  for (const g of graphemes(lines[target]!)) {
    const gw = width(g);
    if (w + gw > col) break;
    w += gw;
    at += g.length;
  }
  return { ...d, cursor: at };
}

// ---------- history ----------

/** What was sent before, newest last; Up walks back through it while the prompt is one line. */
export class History {
  private at: number;
  private stash: string | null = null;

  constructor(private readonly entries: string[] = []) {
    this.at = entries.length;
  }

  get all(): readonly string[] {
    return this.entries;
  }

  push(text: string): void {
    if (text.trim() && this.entries.at(-1) !== text) this.entries.push(text);
    if (this.entries.length > 500) this.entries.splice(0, this.entries.length - 500);
    this.at = this.entries.length;
    this.stash = null;
  }

  prev(current: string): string | null {
    if (this.at === 0) return null;
    if (this.at === this.entries.length) this.stash = current;
    return this.entries[--this.at]!;
  }

  next(): string | null {
    if (this.at >= this.entries.length) return null;
    this.at++;
    return this.at === this.entries.length ? (this.stash ?? "") : this.entries[this.at]!;
  }

  reset(): void {
    this.at = this.entries.length;
    this.stash = null;
  }
}
