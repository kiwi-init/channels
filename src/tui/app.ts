// `kiwi tui`: a person's seat in a channel, in the terminal, laid out like Claude Code. The
// conversation prints into the terminal's own scrollback; below it a live region holds a
// spinner while someone is answering, the prompt box, and a footer that turns into a menu for
// /commands and @names. In coordinator-only mode the person talks with the coordinator.

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { AgentSession } from "../agent.ts";
import { Rejected } from "../agent.ts";
import { saveImages } from "../attach.ts";
import { ChannelGone } from "../client.ts";
import { home, writePrivate } from "../config.ts";
import { fingerprint } from "../identity.ts";
import { formatClaims, formatFact, formatRooms, formatShown, formatStatus, formatTask, formatTasks, mayDo } from "../format.ts";
import { inlineText, NAME_RE, type JoinRequest } from "../membership.ts";
import type { Kind, Message, Presence, TaskState } from "../protocol.ts";
import { COORDINATOR, findRoom, isPerson, parseTaskId, taskId, type ChannelState } from "../state.ts";
import * as ed from "./editor.ts";
import { bannerLines, clean, displayName, eventLines, messageLines, nameStyle, noticeLines, resultLines, truncateStyled, when } from "./render.ts";
import { accent, bad, bold, ESC, faint, good, KeyReader, muted, plain, truncate, warn, width, type Key } from "./term.ts";
import { awaitedFrom, coordinatorFor, route, shows, type View } from "./view.ts";

/** The terminal, as the app uses it: tests pass a fake one. */
export interface Terminal {
  write(s: string): void;
  cols(): number;
  rows(): number;
  onData(cb: (chunk: string) => void): void;
  onResize(cb: () => void): void;
  /** Raw mode on, bracketed paste on. */
  start(): void;
  /** Everything back as it was. */
  stop(): void;
}

export function processTerminal(): Terminal {
  const { stdin, stdout } = process;
  let data: ((s: string) => void) | null = null;
  const onData = (b: Buffer | string) => data?.(typeof b === "string" ? b : b.toString("utf8"));
  return {
    write: (s) => void stdout.write(s),
    cols: () => stdout.columns || 80,
    rows: () => stdout.rows || 24,
    onData: (cb) => void (data = cb),
    onResize: (cb) => void stdout.on("resize", cb),
    start() {
      stdin.setRawMode?.(true);
      stdin.on("data", onData);
      stdin.resume();
      stdout.write(ESC.pasteOn);
    },
    stop() {
      stdout.write(ESC.pasteOff + ESC.showCursor);
      stdin.off("data", onData);
      stdin.setRawMode?.(false);
      stdin.pause();
    },
  };
}

type Entry =
  | { type: "msg"; m: Message }
  | { type: "out"; lines: (cols: number) => string[]; tight?: boolean }
  | { type: "divider"; text: string };

interface Suggestion {
  label: string;
  hint?: string;
  /** What replaces the token being completed. */
  insert: string;
  /** Run at once on Enter (a command that takes nothing more). */
  run?: boolean;
}

interface Command {
  name: string;
  args?: string;
  about: string;
  owner?: boolean;
  aliases?: string[];
  run(arg: string): Promise<void> | void;
  complete?(arg: string): Suggestion[];
}

const SPIN = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
const HISTORY_FILE = () => join(home(), "tui-history.json");
/** How much of the log the screen keeps to redraw from. */
const KEEP = 400;

export interface TuiOptions {
  terminal?: Terminal;
  /** Who the person is here, for the banner ("jonatas (owner)"). */
  label?: string;
}

export async function runTui(s: AgentSession, opts: TuiOptions = {}): Promise<void> {
  const app = new App(s, opts.terminal ?? processTerminal(), opts.label ?? s.me);
  await app.run();
}

class App {
  private state!: ChannelState;
  private log: Entry[] = [];
  private draft: ed.Draft = ed.empty();
  private history: ed.History;
  private view: View = "coordinator";
  /** The room the person writes in, and the only one Everything shows; null is every room (writing to general). */
  private room: string | null = null;
  private live = { lines: 0, cursorRow: 0 };
  private keys = new KeyReader();
  private escTimer: ReturnType<typeof setTimeout> | undefined;
  private menuIndex = 0;
  private menuHidden = false;
  private help = false;
  private waiting: { names: string[] | null; since: number; label: string } | null = null;
  private busy: string | null = null;
  private confirming: { question: string; resolve: (yes: boolean) => void } | null = null;
  private online = new Map<string, Presence>();
  private requests: JoinRequest[] = [];
  private noticed = new Set<string>();
  private relayDown: string | null = null;
  private hint: { text: string; until: number } | null = null;
  private ctrlCAt = 0;
  private escAt = 0;
  private frame = 0;
  private lastPrinted: "event" | "other" | null = null;
  private paintQueued = false;
  private done!: () => void;
  private failed!: (err: unknown) => void;
  private readonly ac = new AbortController();
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private readonly commands: Command[];

  constructor(
    private readonly s: AgentSession,
    private readonly term: Terminal,
    private readonly label: string,
  ) {
    this.history = new ed.History(loadHistory());
    this.commands = this.makeCommands();
  }

  private get me(): string {
    return this.s.me;
  }

  private get coordinator(): string | null {
    return this.state ? coordinatorFor(this.state, this.me) : null;
  }

  /** Listening now, or seen within the presence window. */
  private here(name: string): boolean {
    return name === this.me || this.online.has(name) || Date.now() - (this.state.members.get(name)?.lastSeen ?? 0) < 150_000;
  }

  private get cols(): number {
    // The last column stays empty: writing there leaves terminals in a pending wrap.
    return Math.max(20, this.term.cols() - 1);
  }

  // ---------- life ----------

  async run(): Promise<void> {
    const { messages, state } = await this.s.state();
    this.state = state;
    const since = await this.s.cursor();
    for (const m of messages.slice(-KEEP)) if (m.seq <= since) this.log.push({ type: "msg", m });
    const unread = messages.filter((m) => m.seq > since && shows(m, this.view, state, this.me, this.room)).length;
    if (unread) this.log.push({ type: "divider", text: `${unread} new since you were last here` });

    const finished = new Promise<void>((resolve, reject) => {
      this.done = resolve;
      this.failed = reject;
    });
    this.term.start();
    this.term.onData((chunk) => this.input(chunk));
    let resizing: ReturnType<typeof setTimeout> | undefined;
    this.term.onResize(() => {
      clearTimeout(resizing);
      resizing = setTimeout(() => this.redrawAll(), 60);
    });
    this.redrawAll(false);

    this.timers.push(setInterval(() => this.tick(), 120));
    this.timers.push(setInterval(() => void this.refreshOnline(), 45_000));
    if (this.s.ownerCh) this.timers.push(setInterval(() => void this.refreshRequests(), 30_000));
    void this.refreshOnline();
    void this.refreshRequests();

    void this.s
      .listen((m, st) => this.arrived(m, st), {
        client: "tui",
        all: true,
        signal: this.ac.signal,
        onStatus: (msg) => {
          this.relayDown = /^reached the relay/.test(msg) ? null : msg;
          this.out(msg, this.relayDown ? warn : muted);
        },
        onNotice: () => void this.refreshRequests(),
      })
      .then(() => this.quit())
      .catch((err) => this.fail(err));

    try {
      await finished;
    } finally {
      for (const t of this.timers) clearInterval(t);
      this.ac.abort();
      this.term.write(ESC.up(this.live.cursorRow) + "\r" + ESC.clearBelow);
      this.term.stop();
    }
  }

  private quit(): void {
    this.done();
  }

  private fail(err: unknown): void {
    this.failed(err);
  }

  private arrived(m: Message, state: ChannelState): void {
    this.state = state;
    // The answer is in: the spinner goes before the message prints.
    if (this.waiting && m.kind !== "event" && m.from !== this.me && shows(m, this.view, state, this.me, this.room)) {
      const sender = state.members.get(m.from);
      if (this.waiting.names ? this.waiting.names.includes(m.from) : sender && !isPerson(sender)) this.waiting = null;
    }
    this.push({ type: "msg", m });
    this.schedule();
  }

  // ---------- the scrollback ----------

  private push(e: Entry): void {
    this.log.push(e);
    if (this.log.length > KEEP * 2) this.log.splice(0, this.log.length - KEEP);
    const lines = this.entryLines(e, this.cols, this.lastPrinted);
    if (lines) this.paint(lines);
  }

  /** An entry as lines to print, a blank line before it unless it's an event after an event; null when hidden. */
  private entryLines(e: Entry, cols: number, prev: "event" | "other" | null): string[] | null {
    let lines: string[];
    let kind: "event" | "other" = "other";
    if (e.type === "msg") {
      if (!shows(e.m, this.view, this.state, this.me, this.room)) return null;
      if (e.m.kind === "event") {
        kind = "event";
        lines = eventLines(e.m, this.state, cols);
      } else lines = messageLines(e.m, { state: this.state, me: this.me, coordinator: this.coordinator }, cols);
    } else if (e.type === "divider") {
      const label = ` ${e.text} `;
      const side = Math.max(2, Math.floor((cols - width(label)) / 2));
      lines = [warn(`${"─".repeat(side)}${label}${"─".repeat(Math.max(2, cols - side - width(label)))}`)];
    } else {
      lines = e.lines(cols);
      if (e.tight) kind = "event";
    }
    const gap = prev === null || (kind === "event" && prev === "event") ? [] : [""];
    this.lastPrinted = kind;
    return [...gap, ...lines];
  }

  /** Command output, under the line that asked for it. */
  private out(text: string, style?: (s: string) => string): void {
    this.push({ type: "out", lines: (c) => resultLines(text, c, style), tight: true });
  }

  private echo(command: string): void {
    this.push({ type: "out", lines: () => [muted(`> ${clean(command)}`)] });
  }

  private error(err: unknown): void {
    const text = err instanceof Rejected || err instanceof Error ? err.message : String(err);
    this.out(text, bad);
  }

  /**
   * Clear the screen and print everything again (a resize, Ctrl+L, a view switch). The first
   * draw starts below whatever the terminal already shows, as Claude Code does.
   */
  private redrawAll(clear = true): void {
    const cols = this.cols;
    if (clear) {
      this.term.write(ESC.syncOn + ESC.clearScreen);
      this.live = { lines: 0, cursorRow: 0 };
    }
    this.lastPrinted = null;
    const lines: string[] = [];
    const add = (ls: string[] | null) => ls && lines.push(...ls);
    add(bannerLines({ channel: this.s.cfg.title && this.s.cfg.title !== this.s.alias ? `${this.s.alias} (${this.s.cfg.title})` : this.s.alias, you: this.label, mode: this.modeText(), relay: this.s.cfg.relay }, cols));
    this.lastPrinted = "other";
    // The last screenful or so of what this view shows.
    const visible = this.log.filter((e) => e.type !== "msg" || shows(e.m, this.view, this.state, this.me, this.room));
    for (const e of visible.slice(-80)) add(this.entryLines(e, cols, this.lastPrinted));
    this.paint(lines);
  }

  private modeText(): string | null {
    if (!this.state.mode.coordinatorOnly) return null;
    const c = this.state.coordinator;
    if (!c) return "coordinator-only, no coordinator yet";
    return c === this.me ? "coordinator-only: you are the coordinator" : `coordinator-only: you talk with ${c}`;
  }

  // ---------- the live region ----------

  private schedule(): void {
    if (this.paintQueued) return;
    this.paintQueued = true;
    queueMicrotask(() => {
      this.paintQueued = false;
      this.paint();
    });
  }

  /** Print `lines` above the live region (they scroll away into the terminal's history), then draw it again. */
  private paint(print: string[] = []): void {
    const region = this.region();
    let out = ESC.syncOn + ESC.hideCursor + ESC.up(this.live.cursorRow) + "\r" + ESC.clearBelow;
    if (print.length) out += print.join("\n") + "\n";
    out += region.lines.join("\n");
    out += ESC.up(region.lines.length - 1 - region.row) + ESC.col(region.col) + ESC.showCursor + ESC.syncOff;
    this.live = { lines: region.lines.length, cursorRow: region.row };
    this.term.write(out);
  }

  private region(): { lines: string[]; row: number; col: number } {
    const cols = this.cols;
    const lines: string[] = [""];
    const spin = accent(SPIN[this.frame % SPIN.length]!);
    if (this.busy) lines.push(`${spin} ${this.busy}…`, "");
    else if (this.waiting) {
      const secs = Math.floor((Date.now() - this.waiting.since) / 1000);
      const elapsed = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
      const one = this.waiting.names?.length === 1 ? this.waiting.names[0] : undefined;
      const doing = one ? [...this.state.tasks.values()].find((t) => t.owner === one && t.state === "doing") : undefined;
      const on = doing ? ` · on ${taskId(doing.id)} ${inlineText(doing.title, 40)}` : "";
      lines.push(truncateStyled(`${spin} ${accent(`${this.waiting.label}…`)} ${faint(`(${elapsed}${on} · esc to stop waiting)`)}`, cols), "");
    }

    if (this.confirming) {
      const q = `${warn("?")} ${bold(this.confirming.question)} ${faint("(y/n)")}`;
      lines.push(faint(`╭${"─".repeat(cols - 2)}╮`), boxLine(q, cols, warn), faint(`╰${"─".repeat(cols - 2)}╯`));
      return { lines, row: lines.length - 2, col: Math.min(cols - 3, 3 + width(plain(q))) };
    }

    // The prompt box.
    const inner = cols - 6;
    const lay = ed.layout(this.draft, inner);
    const maxRows = Math.max(1, Math.min(lay.lines.length, this.term.rows() - 10));
    const first = Math.min(Math.max(0, lay.row - maxRows + 1), lay.lines.length - maxRows);
    const shown = lay.lines.slice(first, first + maxRows);
    const top = lines.length;
    lines.push(faint(`╭${"─".repeat(cols - 2)}╮`));
    if (!this.draft.text) lines.push(boxLine(`${accent(">")} ${faint(this.placeholder())}`, cols));
    else shown.forEach((l, i) => lines.push(boxLine(`${i + first === 0 ? accent(">") : " "} ${l}`, cols)));
    lines.push(faint(`╰${"─".repeat(cols - 2)}╯`));
    const row = top + 1 + (lay.row - first);
    const col = 4 + lay.col;

    lines.push(...this.footer(cols));
    return { lines, row, col };
  }

  private placeholder(): string {
    const c = this.coordinator;
    if (c && this.view === "coordinator") return `Write to ${displayName(this.state, c)}. They pass it on. /help for commands`;
    const room = this.room ? `#${this.state.rooms.get(this.room)?.name ?? this.room}` : "the channel";
    return `Write to ${room}. @name addresses someone. /help for commands`;
  }

  private footer(cols: number): string[] {
    const menu = this.suggestions();
    if (menu.length) {
      const pick = Math.min(this.menuIndex, menu.length - 1);
      const start = Math.max(0, Math.min(pick - 3, menu.length - 8));
      const labelW = Math.min(28, Math.max(...menu.map((x) => width(x.label))) + 2);
      return menu.slice(start, start + 8).map((x, i) => {
        const on = start + i === pick;
        const label = width(x.label) < labelW ? x.label + " ".repeat(labelW - width(x.label)) : `${truncate(x.label, labelW - 2)}  `;
        return truncateStyled(`  ${on ? accent(label) : label}${x.hint ? (on ? muted(x.hint) : faint(x.hint)) : ""}`, cols);
      });
    }
    if (this.help) return shortcuts(cols);
    const now = Date.now();
    if (now - this.ctrlCAt < 1500) return [`  ${muted("Press Ctrl-C again to exit")}`];
    if (now - this.escAt < 1500 && this.draft.text) return [`  ${muted("Esc again to clear")}`];
    if (this.hint && this.hint.until > now) return [`  ${muted(this.hint.text)}`];

    const c = this.coordinator;
    let left: string;
    if (c && this.view === "coordinator") left = `${accent("⏵")} ${accent(`with ${displayName(this.state, c)}`)} ${faint("(shift+tab for everything)")}`;
    else if (c) left = `${accent("⏵⏵ everything")} ${faint(`(copied to ${displayName(this.state, c)} · shift+tab to go back)`)}`;
    else if (this.state.mode.coordinatorOnly && !this.state.coordinator) left = `${warn("coordinator-only, no coordinator yet")} ${faint(this.s.ownerCh ? "· /coordinator NAME" : "")}`;
    else left = `${muted(this.room ? `#${this.state.rooms.get(this.room)?.name ?? this.room}` : "#general")} ${faint("· ? for shortcuts")}`;

    const right: string[] = [];
    if (this.relayDown) right.push(warn("relay unreachable, retrying"));
    const asks = this.state.openAsks.filter((m) => m.from !== this.me && (m.to?.includes(this.me) || m.to?.includes("*")) && shows(m, this.view, this.state, this.me, null)).length;
    if (asks) right.push(warn(`${asks} question${asks === 1 ? "" : "s"} for you`) + faint(" (/reply)"));
    const ready = this.requests.length;
    if (ready) right.push(warn(`${ready} join request${ready === 1 ? "" : "s"}`));
    const watch = c ?? this.state.coordinator;
    if (watch && watch !== this.me) right.push(this.here(watch) ? `${good("●")} ${muted(watch)}` : `${faint("○")} ${faint(watch)}`);
    const r = right.join(faint(" · "));
    // Too narrow for both: the hint in brackets goes first, then what's on the right.
    for (const l of [left, left.replace(/ (?:\x1b\[[0-9;]*m)?\(.*$/, "")]) {
      const gap = cols - 2 - width(plain(l)) - width(plain(r));
      if (gap >= 2) return [`  ${l}${" ".repeat(gap)}${r}`];
    }
    return [truncateStyled(`  ${r || left}`, cols)];
  }

  private tick(): void {
    if (!this.busy && !this.waiting && !(this.hint && this.hint.until > Date.now()) && !(Date.now() - this.ctrlCAt < 2000) && !(Date.now() - this.escAt < 2000)) return;
    this.frame++;
    if (this.waiting && Date.now() - this.waiting.since > 15 * 60_000) this.waiting = null;
    this.paint();
  }

  // ---------- completion ----------

  private suggestions(): Suggestion[] {
    if (this.menuHidden || this.confirming) return [];
    const before = this.draft.text.slice(0, this.draft.cursor);
    if (this.draft.text.slice(this.draft.cursor).trim()) return [];
    const slash = /^\/(\S*)$/.exec(before);
    if (slash) {
      const q = slash[1]!.toLowerCase();
      return this.available()
        .filter((c) => [c.name, ...(c.aliases ?? [])].some((n) => n.startsWith(q)))
        .map((c) => ({ label: `/${c.name}${c.args ? ` ${c.args}` : ""}`, hint: c.about, insert: `/${c.name}`, run: !c.args }));
    }
    const arg = /^\/(\S+)\s+(.*)$/s.exec(before);
    if (arg) {
      const cmd = this.find(arg[1]!);
      return cmd?.complete?.(arg[2]!) ?? [];
    }
    const at = /(?:^|\s)@([\p{L}\p{N}_.-]*)$/u.exec(before);
    if (at) return this.memberSuggestions(at[1]!, "@");
    return [];
  }

  private memberSuggestions(q: string, prefix: string, filter: (name: string) => boolean = () => true): Suggestion[] {
    const lower = q.toLowerCase();
    return [...this.state.members.values()]
      .filter((m) => m.active && m.name !== this.me && filter(m.name))
      .filter((m) => m.name.toLowerCase().startsWith(lower) || (m.display ?? "").toLowerCase().startsWith(lower))
      .sort((a, b) => (a.name === this.state.coordinator ? -1 : b.name === this.state.coordinator ? 1 : a.name.localeCompare(b.name)))
      .slice(0, 20)
      .map((m) => ({ label: `${prefix}${m.name}`, hint: [m.role, m.kind === "human" ? "person" : "", this.online.has(m.name) ? "online" : ""].filter(Boolean).join(" · "), insert: `${prefix}${m.name}` }));
  }

  /** Put a suggestion in place of the token it completes. */
  private accept(x: Suggestion): void {
    const before = this.draft.text.slice(0, this.draft.cursor);
    const token = /\S*$/.exec(before)![0];
    const head = before.slice(0, before.length - token.length);
    const text = `${head}${x.insert} `;
    this.draft = { text: text + this.draft.text.slice(this.draft.cursor), cursor: text.length };
    this.menuIndex = 0;
  }

  // ---------- keys ----------

  private input(chunk: string): void {
    clearTimeout(this.escTimer);
    for (const k of this.keys.feed(chunk)) this.key(k);
    // A lone ESC might start a sequence: give the rest a moment to arrive.
    if (this.keys.pending) this.escTimer = setTimeout(() => this.keys.flush().forEach((k) => this.key(k)), 40);
  }

  private key(k: Key): void {
    if (this.confirming) {
      const yes = k.name === "text" && /^y/i.test(k.text);
      const no = (k.name === "text" && /^n/i.test(k.text)) || k.name === "escape" || (k.name === "ctrl" && k.key === "c");
      if (yes || no) {
        const c = this.confirming;
        this.confirming = null;
        c.resolve(yes);
        this.schedule();
      }
      return;
    }
    const menu = this.suggestions();
    const before = this.draft.text;
    if (!(k.name === "text" && k.text === "?")) this.help = false;
    switch (k.name) {
      case "text":
        if (k.text === "?" && !this.draft.text) {
          this.help = !this.help;
          break;
        }
        this.draft = ed.insert(this.draft, k.text);
        break;
      case "paste":
        this.draft = ed.insert(this.draft, k.text);
        break;
      case "return": {
        if (menu.length) {
          const x = menu[Math.min(this.menuIndex, menu.length - 1)]!;
          this.accept(x);
          if (x.run) this.submit();
          break;
        }
        // A backslash right before Enter makes a new line, as in Claude Code.
        if (this.draft.text.slice(0, this.draft.cursor).endsWith("\\")) {
          this.draft = ed.insert(ed.backspace(this.draft), "\n");
          break;
        }
        this.submit();
        break;
      }
      case "newline":
        this.draft = ed.insert(this.draft, "\n");
        break;
      case "backspace":
        this.draft = ed.backspace(this.draft);
        break;
      case "delete":
        this.draft = ed.del(this.draft);
        break;
      case "left":
        this.draft = ed.left(this.draft);
        break;
      case "right":
        this.draft = ed.right(this.draft);
        break;
      case "home":
        this.draft = ed.home(this.draft);
        break;
      case "end":
        this.draft = ed.end(this.draft);
        break;
      case "wordleft":
        this.draft = ed.wordLeft(this.draft);
        break;
      case "wordright":
        this.draft = ed.wordRight(this.draft);
        break;
      case "wordback":
        this.draft = ed.deleteWordBack(this.draft);
        break;
      case "worddelete":
        this.draft = ed.deleteWordForward(this.draft);
        break;
      case "up":
        if (menu.length) this.menuIndex = (Math.min(this.menuIndex, menu.length - 1) - 1 + menu.length) % menu.length;
        else this.historyStep(-1);
        break;
      case "down":
        if (menu.length) this.menuIndex = (Math.min(this.menuIndex, menu.length - 1) + 1) % menu.length;
        else this.historyStep(1);
        break;
      case "tab":
        if (menu.length) this.accept(menu[Math.min(this.menuIndex, menu.length - 1)]!);
        break;
      case "backtab":
        this.switchView();
        break;
      case "pageup":
      case "pagedown":
        break;
      case "escape":
        if (menu.length) this.menuHidden = true;
        else if (this.waiting) this.waiting = null;
        else if (this.draft.text) {
          if (Date.now() - this.escAt < 1500) {
            this.draft = ed.empty();
            this.escAt = 0;
          } else this.escAt = Date.now();
        }
        break;
      case "ctrl":
        this.ctrl(k.key);
        break;
    }
    if (this.draft.text !== before) {
      this.menuHidden = false;
      if (k.name !== "up" && k.name !== "down") this.menuIndex = 0;
      if (k.name !== "up" && k.name !== "down") this.history.reset();
    }
    this.schedule();
  }

  private ctrl(key: string): void {
    switch (key) {
      case "a":
        this.draft = ed.home(this.draft);
        return;
      case "e":
        this.draft = ed.end(this.draft);
        return;
      case "b":
        this.draft = ed.left(this.draft);
        return;
      case "f":
        this.draft = ed.right(this.draft);
        return;
      case "k":
        this.draft = ed.killToEnd(this.draft);
        return;
      case "u":
        this.draft = ed.killToStart(this.draft);
        return;
      case "w":
        this.draft = ed.deleteWordBack(this.draft);
        return;
      case "p":
        this.historyStep(-1);
        return;
      case "n":
        this.historyStep(1);
        return;
      case "l":
        this.redrawAll();
        return;
      case "d":
        if (!this.draft.text) this.quit();
        else this.draft = ed.del(this.draft);
        return;
      case "c":
        if (this.draft.text) {
          this.draft = ed.empty();
          this.ctrlCAt = 0;
          return;
        }
        if (Date.now() - this.ctrlCAt < 1500) return this.quit();
        this.ctrlCAt = Date.now();
        return;
      case "z":
        this.suspend();
        return;
    }
  }

  private historyStep(dir: -1 | 1): void {
    const moved = ed.vertical(this.draft, this.cols - 6, dir);
    if (moved) {
      this.draft = moved;
      return;
    }
    const text = dir < 0 ? this.history.prev(this.draft.text) : this.history.next();
    if (text !== null) this.draft = { text, cursor: text.length };
  }

  private suspend(): void {
    this.term.write(ESC.up(this.live.cursorRow) + "\r" + ESC.clearBelow);
    this.live = { lines: 0, cursorRow: 0 };
    this.term.stop();
    process.once("SIGCONT", () => {
      this.term.start();
      this.redrawAll();
    });
    process.kill(process.pid, "SIGTSTP");
  }

  private switchView(): void {
    if (!this.coordinator) {
      this.flash(this.state.mode.coordinatorOnly ? "No coordinator yet: there's only one view" : "Views switch in coordinator-only mode");
      return;
    }
    this.view = this.view === "coordinator" ? "everything" : "coordinator";
    this.redrawAll();
  }

  private flash(text: string): void {
    this.hint = { text, until: Date.now() + 2500 };
    this.schedule();
  }

  private ask(question: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.confirming = { question, resolve };
      this.schedule();
    });
  }

  // ---------- sending ----------

  private submit(): void {
    const text = this.draft.text.trim();
    this.draft = ed.empty();
    this.menuIndex = 0;
    if (!text) return this.schedule();
    this.history.push(text);
    saveHistory(this.history.all);
    const done = text.startsWith("/") && !text.startsWith("//") ? this.command(text) : this.send(text.startsWith("//") ? text.slice(1) : text);
    done.catch((err) => (err instanceof ChannelGone ? this.fail(err) : this.error(err)));
  }

  private async busyWith<T>(label: string, f: () => Promise<T>): Promise<T | undefined> {
    this.busy = label;
    this.schedule();
    try {
      return await f();
    } catch (err) {
      if (err instanceof ChannelGone) throw err;
      this.error(err);
      return undefined;
    } finally {
      this.busy = null;
      this.schedule();
    }
  }

  /** Send what the person wrote, where the view says it goes. */
  private async send(body: string, opts: { kind?: Kind; re?: number } = {}): Promise<void> {
    const kind = opts.kind ?? "msg";
    let to: string[] | undefined;
    let room: string | undefined = this.room ?? undefined;
    if (opts.re !== undefined) {
      const orig = (await this.s.state()).messages.find((m) => m.seq === opts.re);
      if (!orig) return this.out(`no message #${opts.re}`, bad);
      // With the coordinator, a reply still goes through them; otherwise to whoever wrote it.
      to = this.coordinator && this.view === "coordinator" ? [this.coordinator] : orig.from === this.me ? orig.to : [orig.from];
      room = this.state.roomOf.get(orig.seq) ?? orig.room;
    } else to = route(body, this.view, this.state, this.me);
    const seq = await this.busyWith("Sending", () => this.s.send(body, { to, kind, ...(opts.re !== undefined ? { re: [opts.re] } : {}), ...(room ? { room } : {}) }));
    if (seq === undefined) return;
    const m = { v: 1, id: `local-${seq}`, seq, from: this.me, kind, body, ts: Date.now(), rts: Date.now(), ...(to ? { to } : {}), ...(opts.re !== undefined ? { re: [opts.re] } : {}), ...(room ? { room } : {}) } as Message;
    this.push({ type: "msg", m });
    // Our own messages don't come back on the stream: fold again so an answered question closes.
    void this.fresh()
      .then(() => this.schedule())
      .catch(() => {});
    const { names, shown } = awaitedFrom(to, this.state, this.me);
    this.waiting = { names, since: Date.now(), label: shown.length ? `Waiting for ${shown.map((n) => displayName(this.state, n)).join(", ")}` : "Waiting for a reply" };
    this.schedule();
  }

  // ---------- commands ----------

  private available(): Command[] {
    return this.commands.filter((c) => !c.owner || this.s.ownerCh);
  }

  private find(name: string): Command | undefined {
    const n = name.toLowerCase();
    return this.available().find((c) => c.name === n || c.aliases?.includes(n));
  }

  private async command(text: string): Promise<void> {
    const m = /^\/(\S+)\s*([\s\S]*)$/.exec(text)!;
    const cmd = this.find(m[1]!);
    if (!cmd) {
      const exists = this.commands.find((c) => c.name === m[1] || c.aliases?.includes(m[1]!));
      this.echo(text);
      return this.out(exists ? `/${m[1]} is the channel owner's` : `unknown command /${m[1]}: /help lists them`, bad);
    }
    // What it sends prints as a message, so /ask and /reply don't echo too.
    if (!["clear", "quit", "ask", "reply"].includes(cmd.name)) this.echo(text);
    try {
      await cmd.run(m[2]!.trim());
    } catch (err) {
      if (err instanceof ChannelGone) return this.fail(err);
      this.error(err);
    }
    this.schedule();
  }

  private async fresh(): Promise<{ messages: Message[]; state: ChannelState }> {
    const got = await this.s.state();
    this.state = got.state;
    return got;
  }

  private async refreshOnline(): Promise<void> {
    try {
      this.online = await this.s.who();
      this.schedule();
    } catch {}
  }

  private async refreshRequests(): Promise<void> {
    if (!this.s.ownerCh) return;
    let reqs: JoinRequest[];
    try {
      reqs = await this.s.requests();
    } catch {
      return;
    }
    this.requests = reqs.filter((r) => r.check === "ready" || r.check === "unchecked");
    for (const r of reqs) {
      const key = `${r.id}:${r.check}`;
      if (this.noticed.has(key) || r.check === "waiting") continue;
      this.noticed.add(key);
      const who = r.kind === "human" ? `a person, signed in as ${inlineText(r.sponsoredBy?.name ?? "?", 60)}` : r.sponsoredBy ? `an agent of ${inlineText(r.sponsoredBy.name, 60)}` : "an agent";
      const name = inlineText(r.name, 40);
      if (r.reclaims) {
        this.push({ type: "out", lines: (c) => noticeLines(`${inlineText(r.reclaims!.name, 40)} wants its seat back with a new key`, `Approve a RECLAIM with kiwi approve ${r.code ?? ""} in a terminal, only once you're sure the old key is lost.`, c) });
      } else if (r.check === "ready" && r.code) {
        const digits = r.code.replace(/\D/g, "");
        this.push({
          type: "out",
          lines: (c) => noticeLines(`Join request: ${name}${r.role ? ` (${inlineText(r.role, 30)})` : ""}, ${who}`, `Verification code ${r.code}. Once ${r.kind === "human" ? "they show" : "its terminal shows"} the same code: /approve ${digits}   or /deny ${digits}`, c),
        });
      } else if (r.check === "unchecked") {
        this.push({ type: "out", lines: (c) => noticeLines(`Join request: ${name}, ${who}`, `This computer has checked its share of requests today. To check this one anyway: /check ${fingerprint(r.pk)}`, c) });
      }
    }
    this.schedule();
  }

  private makeCommands(): Command[] {
    const names = (q: string, filter?: (n: string) => boolean) => this.memberSuggestions(q.replace(/^@/, ""), "", filter);
    const requestCodes = (q: string): Suggestion[] =>
      this.requests
        .filter((r) => r.code && r.code.replace(/\D/g, "").startsWith(q.replace(/\D/g, "")))
        .map((r) => ({ label: r.code!.replace(/\D/g, ""), hint: `${inlineText(r.name, 40)}${r.role ? ` (${inlineText(r.role, 30)})` : ""}`, insert: r.code!.replace(/\D/g, ""), run: true }));
    const openAsks = (q: string): Suggestion[] =>
      this.state.openAsks
        .filter((m) => m.from !== this.me && String(m.seq).startsWith(q.replace(/^#/, "")))
        .slice(-8)
        .reverse()
        .map((m) => ({ label: String(m.seq), hint: `${m.from}: ${inlineText(m.body, 60)}`, insert: String(m.seq) }));
    const seqArg = (arg: string) => {
      const n = Number(arg.replace(/^#/, "").split(/\s/)[0]);
      if (!Number.isInteger(n) || n <= 0) throw new Rejected("give a message number, like 42");
      return n;
    };

    return [
      { name: "help", aliases: ["?"], about: "commands and shortcuts", run: () => this.showHelp() },
      {
        name: "view",
        args: "[with|everything]",
        about: "talk with the coordinator, or read everything (shift+tab)",
        run: (arg) => {
          if (!this.coordinator) return this.out("Views switch in coordinator-only mode, once there's a coordinator.");
          const want: View = /^e/i.test(arg) ? "everything" : /^w|^c/i.test(arg) ? "coordinator" : this.view === "coordinator" ? "everything" : "coordinator";
          if (want !== this.view) this.switchView();
        },
        complete: (q) => ["with", "everything"].filter((x) => x.startsWith(q)).map((x) => ({ label: x, insert: x, run: true })),
      },
      {
        name: "status",
        about: "members, tasks, claims, facts",
        run: async () => {
          const { messages, state } = await this.fresh();
          const unread = await this.s.unreadCount(state, messages);
          this.out(formatStatus({ alias: this.s.alias, me: this.me, state, online: new Map([...this.online].map(([n, p]) => [n, { client: p.client, role: p.role }])), unread }));
        },
      },
      {
        name: "members",
        aliases: ["who"],
        about: "who's here, their roles, who's online",
        run: async () => {
          await this.refreshOnline();
          const { state } = await this.fresh();
          const rows = [...state.members.values()]
            .filter((m) => m.active)
            .sort((a, b) => Number(isPerson(b)) - Number(isPerson(a)) || a.name.localeCompare(b.name))
            .map((m) => {
              const on = this.here(m.name) ? good("●") : faint("○");
              const name = nameStyle(state, m.name)(bold(m.name));
              const kind = m.owner ? "owner" : isPerson(m) ? "person" : m.sponsor ? `agent of @${m.sponsor.handle ?? m.sponsor.name}` : "agent";
              const where = m.name === this.me ? "you" : this.online.has(m.name) ? `online (${this.online.get(m.name)!.client})` : `seen ${when(m.lastSeen || m.joined)}`;
              const bits = [...new Set([m.role ?? "", kind, where].filter(Boolean).map((b) => inlineText(b, 60)))];
              return `${on} ${name}  ${faint(bits.join(" · "))}${!m.owner && m.scopes.length < 5 ? faint(` · may ${mayDo(m.scopes)}`) : ""}`;
            });
          this.push({ type: "out", lines: () => rows.map((r, i) => (i === 0 ? `${faint("  ⎿  ")}${r}` : `     ${r}`)), tight: true });
        },
      },
      {
        name: "tasks",
        args: "[all]",
        about: "the task board",
        run: async (arg) => this.out(formatTasks((await this.fresh()).state, { all: /^a/i.test(arg) })),
        complete: (q) => ("all".startsWith(q) ? [{ label: "all", hint: "done and cancelled too", insert: "all", run: true }] : []),
      },
      {
        name: "task",
        args: "add TITLE | T7 [done|assign NAME|…]",
        about: "add, show or move a task",
        run: (arg) => this.task(arg),
        complete: (q) => {
          if (/\s/.test(q)) {
            const [, verb] = /^\S+\s+(\S*)$/.exec(q) ?? [];
            if (verb === undefined || q.startsWith("add")) return [];
            return ["done", "start", "block", "review", "cancel", "assign", "note", "drop"].filter((v) => v.startsWith(verb)).map((v) => ({ label: v, insert: v }));
          }
          const open = [...this.state.tasks.values()].filter((t) => t.state !== "done" && t.state !== "cancelled" && taskId(t.id).toLowerCase().startsWith(q.toLowerCase() || "t"));
          return [{ label: "add", hint: "a new task", insert: "add" }, ...open.slice(0, 10).map((t) => ({ label: taskId(t.id), hint: `${t.state}${t.owner ? ` @${t.owner}` : ""} · ${inlineText(t.title, 50)}`, insert: taskId(t.id) }))].filter((x) => x.label.toLowerCase().startsWith(q.toLowerCase()));
        },
      },
      { name: "ask", args: "TEXT", about: "ask a question (it stays open until answered)", run: (arg) => (arg ? this.send(arg, { kind: "ask" }) : this.out("usage: /ask TEXT", bad)) },
      {
        name: "reply",
        args: "N TEXT",
        about: "answer message #N",
        run: (arg) => {
          const n = seqArg(arg);
          const body = arg.replace(/^#?\d+\s*/, "");
          if (!body) return this.out("usage: /reply N TEXT", bad);
          return this.send(body, { re: n });
        },
        complete: (q) => (/\s/.test(q) ? [] : openAsks(q)),
      },
      {
        name: "thread",
        args: "N",
        about: "the whole thread message #N is in",
        run: async (arg) => {
          const n = seqArg(arg);
          const { messages, state } = await this.fresh();
          const root = state.threadOf.get(n) ?? n;
          const thread = messages.filter((m) => (state.threadOf.get(m.seq) ?? m.seq) === root && m.kind !== "event" && shows(m, "everything", state, this.me, null));
          if (!thread.length) return this.out(`no message #${n}`, bad);
          const ctx = { state, me: this.me, coordinator: this.coordinator };
          this.push({ type: "out", lines: (c) => thread.flatMap((m, i) => [...(i ? [""] : []), ...messageLines(m, ctx, c - 4).map((l) => `${faint("  │ ")}${l}`)]) });
        },
      },
      {
        name: "show",
        args: "N",
        about: "message #N in full, its images saved",
        run: async (arg) => {
          const n = seqArg(arg);
          const { messages, state } = await this.fresh();
          const m = messages.find((x) => x.seq === n);
          if (!m) return this.out(`no message #${n}`, bad);
          const saved = m.imgs?.length ? saveImages(n, m.imgs, join(home(), "downloads", this.s.ch.roomId)) : [];
          this.out(formatShown(m, messages, state, saved));
        },
      },
      {
        name: "room",
        args: "[NAME|all]",
        about: "write in a room (and show only it)",
        run: async (arg) => {
          const { state } = await this.fresh();
          if (!arg) return this.out(formatRooms(state));
          if (/^(all|\*)$/i.test(arg)) {
            this.room = null;
            this.redrawAll();
            return;
          }
          const r = findRoom(state, arg);
          if (!r) return this.out(`no room ${arg}: /room lists them`, bad);
          this.room = r.id;
          this.redrawAll();
        },
        complete: (q) => [...this.state.rooms.values()].filter((r) => r.name.startsWith(q.replace(/^#/, ""))).map((r) => ({ label: `#${r.name}`, insert: r.name, run: true })),
      },
      { name: "facts", about: "shared facts", run: async () => this.out([...(await this.fresh()).state.facts.values()].map((f) => formatFact(f)).join("\n") || "no facts") },
      { name: "claims", about: "claimed paths", run: async () => this.out(formatClaims((await this.fresh()).state)) },
      {
        name: "requests",
        owner: true,
        about: "pending join requests",
        run: async () => {
          await this.refreshRequests();
          const reqs = await this.s.requests();
          if (!reqs.length) return this.out("no pending join requests");
          this.out(
            reqs
              .map((r) => `${(r.code ?? r.check).padEnd(8)} ${r.reclaims ? `RECLAIMS ${r.reclaims.name}'s seat` : r.name}${r.role ? ` (${r.role})` : ""} · ${r.kind === "human" ? "person" : r.sponsoredBy ? `agent of ${r.sponsoredBy.name}` : "agent"} · key ${fingerprint(r.pk)}`)
              .join("\n"),
          );
        },
      },
      {
        name: "approve",
        owner: true,
        args: "CODE [as NAME] [role ROLE]",
        about: "let a requester in, once the codes match",
        run: (arg) => this.approve(arg),
        complete: (q) => (/\s/.test(q) ? [] : requestCodes(q)),
      },
      {
        name: "deny",
        owner: true,
        args: "CODE",
        about: "refuse a join request",
        run: async (arg) => {
          const r = this.findRequest(arg);
          await this.busyWith("Denying", () => this.s.ownerCh!.deny(r.id));
          this.out(`denied ${inlineText(r.name, 40)}`);
          void this.refreshRequests();
        },
        complete: (q) => (/\s/.test(q) ? [] : requestCodes(q)),
      },
      {
        name: "check",
        owner: true,
        args: "KEY",
        about: "start the code check for a request past today's share",
        run: async (arg) => {
          const r = (await this.s.requests()).find((x) => x.check === "unchecked" && !x.reclaims && arg && fingerprint(x.pk).startsWith(arg));
          if (!r) return this.out(`no unchecked request with key ${arg}`, bad);
          await this.busyWith("Checking", () => this.s.ownerCh!.checkRequest(r));
          this.out(`checking ${inlineText(r.name, 40)}: its code shows in a moment`);
          setTimeout(() => void this.refreshRequests(), 1500);
        },
      },
      {
        name: "coordinator",
        owner: true,
        args: "NAME|none",
        about: "make an agent the coordinator",
        run: async (arg) => {
          const name = arg.replace(/^@/, "");
          if (!name) return this.out(this.state.coordinator ? `${this.state.coordinator} is the coordinator` : "no coordinator yet: /coordinator NAME", this.state.coordinator ? undefined : warn);
          if (name === "none") {
            if (!this.state.coordinator) return this.out("there's no coordinator");
            await this.busyWith("Saving", () => this.s.decideRole(this.state.coordinator!, { role: null }));
          } else await this.busyWith("Saving", () => this.s.decideRole(name, { role: COORDINATOR }));
          const { state } = await this.fresh();
          this.out(name === "none" ? "no coordinator now" : `${name} is the coordinator${state.mode.coordinatorOnly ? "" : ". /mode on routes people through them"}`);
          this.redrawAll();
        },
        complete: (q) => [...names(q, (n) => !isPerson(this.state.members.get(n)!)), ...("none".startsWith(q) && this.state.coordinator ? [{ label: "none", hint: "no coordinator", insert: "none", run: true }] : [])],
      },
      {
        name: "mode",
        owner: true,
        args: "on|off [loose]",
        about: "coordinator-only: people talk only with the coordinator",
        run: async (arg) => {
          const [onOff, loose] = arg.split(/\s+/);
          if (onOff !== "on" && onOff !== "off") return this.out(this.modeText() ?? "mode: normal. /mode on routes people through the coordinator");
          await this.busyWith("Saving", () => this.s.setMode(onOff === "on", !/^l/i.test(loose ?? "")));
          await this.fresh();
          this.view = "coordinator";
          this.out(this.modeText() ?? "coordinator-only is off");
          this.redrawAll();
        },
        complete: (q) =>
          [
            { label: "on", hint: "strict: agents other than the coordinator can't message people", insert: "on", run: true },
            { label: "on loose", hint: "they can, flagged as not through the coordinator", insert: "on loose", run: true },
            { label: "off", hint: "everyone talks with everyone", insert: "off", run: true },
          ].filter((x) => x.label.startsWith(q)),
      },
      {
        name: "role",
        owner: true,
        args: "NAME ROLE|none",
        about: "set a member's role",
        run: async (arg) => {
          const [name, ...rest] = arg.split(/\s+/);
          const role = rest.join(" ");
          if (!name || !role) return this.out("usage: /role NAME ROLE (or none)", bad);
          await this.busyWith("Saving", () => this.s.decideRole(name.replace(/^@/, ""), { role: role === "none" ? null : role }));
          await this.fresh();
          this.out(role === "none" ? `cleared ${name}'s role` : `made ${name} ${role}`);
        },
        complete: (q) => (/\s/.test(q) ? [] : names(q)),
      },
      {
        name: "kick",
        owner: true,
        args: "NAME",
        about: "remove a member (the channel key rotates)",
        run: async (arg) => {
          const name = arg.replace(/^@/, "");
          const m = (await this.s.members(true)).find((x) => x.name === name && x.active);
          if (!m) return this.out(`"${name}" isn't a member`, bad);
          if (m.owner) return this.out("the owner can't be removed", bad);
          if (!(await this.ask(`Remove ${name} from the channel?`))) return this.out("kept them");
          await this.busyWith("Removing", () => this.s.ownerCh!.remove(m.pk));
          this.out(`removed ${name}; the channel key rotated so they can't read anything new`);
        },
        complete: (q) => names(q),
      },
      {
        name: "clear",
        about: "clear the screen",
        run: () => {
          this.log = [];
          this.redrawAll();
        },
      },
      { name: "quit", aliases: ["exit", "q"], about: "leave the TUI (you stay in the channel)", run: () => this.quit() },
    ];
  }

  private showHelp(): void {
    const cmds = this.available();
    const w = Math.min(34, Math.max(...cmds.map((c) => width(`/${c.name}${c.args ? ` ${c.args}` : ""}`))) + 2);
    this.push({
      type: "out",
      tight: true,
      lines: (cols) => {
        const rows = cmds.map((c) => {
          const label = `/${c.name}${c.args ? ` ${c.args}` : ""}`;
          return label.length + 2 > w ? [`${accent(label)}`, `${" ".repeat(w)}${faint(c.about)}`] : [`${accent(label)}${" ".repeat(w - width(label))}${faint(c.about)}`];
        });
        const lines = [bold("Commands"), ...rows.flat(), "", bold("Writing"), `${faint("@name")} at the start addresses someone · ${faint("//text")} sends text starting with /`, ...(this.coordinator ? [`In ${accent(`with ${this.coordinator}`)} everything goes to them; in ${accent("everything")} it goes as written, copied to them.`] : []), "", bold("Shortcuts"), ...shortcutRows()];
        return lines.map((l, i) => truncateStyled(i === 0 ? `${faint("  ⎿  ")}${l}` : `     ${l}`, cols));
      },
    });
  }

  private findRequest(arg: string): JoinRequest {
    const digits = arg.split(/\s/)[0]!.replace(/\D/g, "");
    if (digits.length !== 6) throw new Rejected("use the 6-digit verification code from the request, not a name");
    const matches = this.requests.filter((r) => r.code?.replace(/\D/g, "") === digits);
    if (matches.length > 1) throw new Rejected(`several requests share code ${digits}: deny them all and ask the requesters to try again`);
    if (!matches[0]) throw new Rejected(`no pending request shows code ${digits} (/requests lists them)`);
    return matches[0];
  }

  private async approve(arg: string): Promise<void> {
    await this.refreshRequests();
    const r = this.findRequest(arg);
    if (r.reclaims) return this.out(`a RECLAIM moves ${r.reclaims.name}'s seat to a new key: do it with kiwi approve ${r.code} in a terminal, where it checks the old key isn't online`, warn);
    const as = /\bas\s+(\S+)/.exec(arg)?.[1];
    const roleArg = /\brole\s+(.+)$/.exec(arg)?.[1]?.trim();
    const name = as ?? r.name;
    if (!NAME_RE.test(name) || name === "human") return this.out(`"${name}" isn't an allowed name: /approve ${arg.split(/\s/)[0]} as NAME`, bad);
    if ((await this.s.members(true)).some((m) => m.name === name && m.active)) return this.out(`"${name}" is already a member: approve under another name with /approve ${arg.split(/\s/)[0]} as NAME`, bad);
    // Asking to be the coordinator doesn't make you one: the owner says so themselves.
    const askedCoordinator = r.role?.trim().toLowerCase() === COORDINATOR && roleArg?.toLowerCase() !== COORDINATOR;
    const role = roleArg ?? (askedCoordinator ? undefined : r.role);
    const admitted = await this.busyWith("Approving", () => this.s.ownerCh!.approve(r, { name, role, about: r.about }));
    if (!admitted) return;
    this.out(`approved ${admitted.name} (${r.code})${askedCoordinator ? `; it asked to be the coordinator: /coordinator ${admitted.name}` : ""}`, good);
    this.noticed.add(`${r.id}:done`);
    void this.refreshRequests();
  }

  private async task(arg: string): Promise<void> {
    const add = /^add\s+([\s\S]+)$/i.exec(arg);
    if (add) {
      let title = add[1]!.trim();
      const owner = /\s@([\p{L}\p{N}_.-]+)$/u.exec(title)?.[1];
      if (owner) title = title.slice(0, title.length - owner.length - 2).trim();
      const id = await this.busyWith("Adding", () => this.s.taskAdd(title, owner ? { owner } : {}));
      if (id !== undefined) this.out(`added ${taskId(id)} “${title}”${owner ? ` for ${owner}` : ""}`);
      return;
    }
    const [rawId, verb, ...rest] = arg.split(/\s+/);
    const id = rawId ? parseTaskId(rawId) : null;
    if (id === null) return this.out("usage: /task add TITLE [@owner], or /task T7 [done|start|block|review|cancel|assign NAME|note TEXT|drop]", bad);
    const note = rest.join(" ") || undefined;
    const STATE: Record<string, TaskState> = { done: "done", start: "doing", doing: "doing", block: "blocked", blocked: "blocked", review: "review", cancel: "cancelled", todo: "todo" };
    let state: ChannelState | undefined;
    if (!verb) {
      const t = (await this.fresh()).state.tasks.get(id);
      return t ? this.out(formatTask(this.state, t)) : this.out(`no task ${taskId(id)}`, bad);
    }
    if (verb in STATE) state = await this.busyWith("Saving", () => this.s.taskUpdate(id, { state: STATE[verb], note }));
    else if (verb === "assign") state = await this.busyWith("Saving", () => this.s.taskUpdate(id, { owner: (rest[0] ?? "").replace(/^@/, "") || null }));
    else if (verb === "drop") state = await this.busyWith("Saving", () => this.s.taskUpdate(id, { owner: null, note }));
    else if (verb === "note") state = note ? await this.busyWith("Saving", () => this.s.taskUpdate(id, { note })) : (this.out("usage: /task T7 note TEXT", bad), undefined);
    else return this.out(`unknown: /task ${taskId(id)} ${verb}`, bad);
    const t = state?.tasks.get(id);
    if (t) this.out(`${taskId(id)} ${t.state}${t.owner ? ` @${t.owner}` : ""}: ${inlineText(t.title, 200)}`);
  }
}

function boxLine(content: string, cols: number, edge: (s: string) => string = faint): string {
  const inner = cols - 4;
  const w = width(plain(content));
  return `${edge("│")} ${w > inner ? truncateStyled(content, inner) : content + " ".repeat(inner - w)} ${edge("│")}`;
}

function shortcutRows(): string[] {
  const rows: [string, string][] = [
    ["enter", "send"],
    ["\\ enter · ctrl+j · alt+enter", "new line"],
    ["shift+tab", "with the coordinator ⇄ everything"],
    ["tab · ↑↓", "complete · pick"],
    ["↑ ↓", "earlier messages you wrote"],
    ["esc", "stop waiting · close the menu · twice: clear"],
    ["ctrl+a e · alt+b f", "line start/end · word back/forward"],
    ["ctrl+w u k", "delete word · to start · to end"],
    ["ctrl+l", "redraw"],
    ["ctrl+c twice · ctrl+d", "quit"],
  ];
  return rows.map(([k, v]) => `${muted(k.padEnd(30))}${faint(v)}`);
}

function shortcuts(cols: number): string[] {
  return shortcutRows().map((l) => truncateStyled(`  ${l}`, cols));
}

function loadHistory(): string[] {
  try {
    const path = HISTORY_FILE();
    if (!existsSync(path)) return [];
    const got = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(got) ? got.filter((x): x is string => typeof x === "string").slice(-500) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: readonly string[]): void {
  try {
    writePrivate(HISTORY_FILE(), JSON.stringify(entries.slice(-500)));
  } catch {}
}
