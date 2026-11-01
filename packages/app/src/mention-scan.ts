export type Span = { start: number; end: number };

export type Image = Span & { url: string; alt: string };

export type Tree = { spans: Span[]; images: Image[] };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DEFINITION = /^ {0,3}\[((?:[^\]\\]|\\.)+)\]:[ \t]*\S/;
const HTML_BLOCK =
  /^ {0,3}<(?:!--|[?!]|\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|pre|script|search|section|style|summary|table|tbody|td|textarea|tfoot|th|thead|title|tr|track|ul)(?:[\s/>]|$))/i;
const HTML_TAG_LINE = /^ {0,3}(?:<[A-Za-z][\w-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[A-Za-z][\w-]*\s*>)[ \t]*$/;
const BLANK = /^[ \t]*$/;
const INDENTED = /^(?: {4}|\t)/;
const AUTOLINK = /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[\w.!#$%&'*+/=?^`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/;
const INLINE_HTML = /^<\/?[A-Za-z][\w-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>/;
const URL_START = /(?:https?:\/\/|www\.)/iy;
const EMAIL = /[\w.+-]+@[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+/y;
const WORDY = /[\p{L}\p{N}]/u;
const SPACE = /\s/u;
const PUNCT = /[\p{P}\p{S}]/u;

const labelKey = (label: string): string => label.trim().replace(/\s+/g, " ").toLowerCase();

function blocks(text: string, out: boolean[]): Set<string> {
  const defined = new Set<string>();
  let at = 0;
  let fence: { mark: string; size: number } | null = null;
  let html = false;
  let previousBlank = true;
  let inCode = false;
  while (at <= text.length) {
    const nl = text.indexOf("\n", at);
    const end = nl === -1 ? text.length : nl;
    const line = text.slice(at, end);
    const blank = BLANK.test(line);
    const hide = () => {
      for (let i = at; i < end; i++) out[i] = true;
    };
    if (fence) {
      hide();
      const close = FENCE.exec(line);
      if (close && close[1]![0] === fence.mark && close[1]!.length >= fence.size && BLANK.test(line.slice(close[0].length))) fence = null;
    } else if (html) {
      if (blank) html = false;
      else hide();
    } else {
      const open = FENCE.exec(line);
      const def = DEFINITION.exec(line);
      if (open && !(open[1]![0] === "`" && line.slice(open[0].length).includes("`"))) {
        fence = { mark: open[1]![0]!, size: open[1]!.length };
        hide();
        inCode = false;
      } else if (!blank && INDENTED.test(line) && (previousBlank || inCode)) {
        hide();
        inCode = true;
      } else if (HTML_BLOCK.test(line) || (HTML_TAG_LINE.test(line) && previousBlank)) {
        html = true;
        hide();
        inCode = false;
      } else if (def && previousBlank) {
        defined.add(labelKey(def[1]!));
        hide();
        inCode = false;
      } else if (!blank) inCode = false;
    }
    previousBlank = blank && !fence;
    if (nl === -1) break;
    at = nl + 1;
  }
  return defined;
}

function closingBracket(text: string, from: number, hidden: boolean[]): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (hidden[i]) return -1;
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "[") depth++;
    else if (c === "]") {
      if (depth === 0) return i;
      depth--;
    } else if (c === "\n" && text[i + 1] === "\n") return -1;
  }
  return -1;
}

function destination(text: string, from: number): { end: number; url: string } | null {
  if (text[from] !== "(") return null;
  let i = from + 1;
  while (text[i] === " " || text[i] === "\t" || text[i] === "\n") i++;
  let url: string;
  if (text[i] === "<") {
    const close = text.indexOf(">", i);
    if (close === -1 || text.slice(i, close).includes("\n")) return null;
    url = text.slice(i + 1, close);
    i = close + 1;
  } else {
    let depth = 0;
    const start = i;
    for (; i < text.length; i++) {
      const c = text[i]!;
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") {
        if (depth === 0) break;
        depth--;
      } else if (/\s/.test(c)) break;
    }
    url = text.slice(start, i);
  }
  while (text[i] === " " || text[i] === "\t" || text[i] === "\n") i++;
  const quote = text[i];
  if (quote === '"' || quote === "'" || quote === "(") {
    const close = text.indexOf(quote === "(" ? ")" : quote, i + 1);
    if (close === -1) return null;
    i = close + 1;
    while (text[i] === " " || text[i] === "\t" || text[i] === "\n") i++;
  }
  return text[i] === ")" ? { end: i + 1, url: url.replace(/\\([!-/:-@[-`{-~])/g, "$1") } : null;
}

function trimUrl(text: string, start: number, end: number): number {
  let e = end;
  for (;;) {
    const last = text[e - 1];
    if (last && "?!.,:*_~'\"".includes(last)) e--;
    else if (last === ")") {
      const part = text.slice(start, e);
      if ((part.match(/\(/g) ?? []).length < (part.match(/\)/g) ?? []).length) e--;
      else break;
    } else if (last === ";" && /&[A-Za-z0-9]+;$/.test(text.slice(start, e))) e = start + text.slice(start, e).lastIndexOf("&");
    else break;
  }
  return e;
}

function flank(text: string, start: number, end: number): { left: boolean; right: boolean } {
  const before = start === 0 ? "\n" : text[start - 1]!;
  const after = end >= text.length ? "\n" : text[end]!;
  const left = !SPACE.test(after) && (!PUNCT.test(after) || SPACE.test(before) || PUNCT.test(before));
  const right = !SPACE.test(before) && (!PUNCT.test(before) || SPACE.test(after) || PUNCT.test(after));
  return { left: left && (!right || PUNCT.test(before)), right: right && (!left || PUNCT.test(after)) };
}

export function scanTree(text: string): Tree {
  const hidden: boolean[] = new Array<boolean>(text.length).fill(false);
  const cut = new Set<number>();
  const defined = blocks(text, hidden);
  const images: Image[] = [];
  const hide = (from: number, to: number) => {
    for (let i = from; i < to; i++) hidden[i] = true;
  };
  const runs: { start: number; end: number; left: boolean; right: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    if (hidden[i]) {
      i++;
      continue;
    }
    const c = text[i]!;
    if (c === "\\" && i + 1 < text.length && /[!-/:-@[-`{-~]/.test(text[i + 1]!)) {
      i += 2;
      continue;
    }
    if (c === "`") {
      let n = 1;
      while (text[i + n] === "`") n++;
      let close = -1;
      for (let j = i + n; j < text.length && !hidden[j];) {
        if (text[j] === "`") {
          let m = 1;
          while (text[j + m] === "`") m++;
          if (m === n) {
            close = j;
            break;
          }
          j += m;
        } else j++;
      }
      if (close !== -1) {
        hide(i, close + n);
        i = close + n;
      } else i += n;
      continue;
    }
    if (c === "!" && text[i + 1] === "[") {
      const close = closingBracket(text, i + 2, hidden);
      const dest = close === -1 ? null : destination(text, close + 1);
      if (dest) {
        images.push({ start: i, end: dest.end, url: dest.url, alt: text.slice(i + 2, close) });
        hide(i, dest.end);
        i = dest.end;
        continue;
      }
    }
    if (c === "[") {
      const close = closingBracket(text, i + 1, hidden);
      if (close !== -1) {
        const dest = destination(text, close + 1);
        if (dest) {
          hide(i, dest.end);
          i = dest.end;
          continue;
        }
        const label = text.slice(i + 1, close);
        if (text[close + 1] === "[") {
          const end = text.indexOf("]", close + 2);
          const named = end === -1 ? "" : text.slice(close + 2, end) || label;
          if (end !== -1 && defined.has(labelKey(named))) {
            hide(i, end + 1);
            i = end + 1;
            continue;
          }
        } else if (defined.has(labelKey(label))) {
          hide(i, close + 1);
          i = close + 1;
          continue;
        }
      }
    }
    if (c === "<") {
      const rest = text.slice(i);
      const m = AUTOLINK.exec(rest) ?? INLINE_HTML.exec(rest);
      if (m) {
        hide(i, i + m[0].length);
        i += m[0].length;
        continue;
      }
    }
    if (c === "_" || c === "*") {
      let n = 1;
      while (text[i + n] === c) n++;
      if (c === "_") runs.push({ start: i, end: i + n, ...flank(text, i, i + n) });
      i += n;
      continue;
    }
    const before = i === 0 ? "" : text[i - 1]!;
    if (!WORDY.test(before) && before !== "@" && before !== "/") {
      URL_START.lastIndex = i;
      if (URL_START.test(text)) {
        let e = i;
        while (e < text.length && !/[\s<]/.test(text[e]!) && !hidden[e]) e++;
        e = trimUrl(text, i, e);
        if (e > i + 4) {
          hide(i, e);
          i = e;
          continue;
        }
      }
      EMAIL.lastIndex = i;
      const mail = EMAIL.exec(text);
      if (mail && !/[-_]$/.test(mail[0]) && text[i] !== "@") {
        const e = i + mail[0].replace(/\.$/, "").length;
        hide(i, e);
        i = e;
        continue;
      }
    }
    i++;
  }
  const openers: { start: number; end: number }[] = [];
  for (const run of runs) {
    if (run.right) {
      const open = openers.pop();
      if (open) {
        cut.add(open.end);
        cut.add(run.start);
        hide(open.start, open.end);
        hide(run.start, run.end);
        continue;
      }
    }
    if (run.left) openers.push(run);
  }
  const spans: Span[] = [];
  let from = -1;
  for (let k = 0; k <= text.length; k++) {
    const off = k === text.length || hidden[k] || cut.has(k);
    if (from !== -1 && (off || text[k] === "\n")) {
      if (k > from) spans.push({ start: from, end: k });
      from = -1;
    }
    if (k < text.length && !hidden[k] && from === -1 && text[k] !== "\n") from = k;
  }
  return { spans, images };
}
