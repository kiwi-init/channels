import type { TermOpened, TermWatch } from "~/model"

const DIM = "\x1b[2m"
const BOLD = "\x1b[1m"
const OFF = "\x1b[0m"
const ORANGE = "\x1b[38;5;173m"
const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const GREY = "\x1b[90m"

function box(cols: number, lines: string[], tint = GREY): string[] {
  const w = Math.max(20, Math.min(cols - 2, 96))
  const bare = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "")
  return [
    `${tint}╭${"─".repeat(w - 2)}╮${OFF}`,
    ...lines.map((l) => `${tint}│${OFF} ${l}${" ".repeat(Math.max(0, w - 4 - [...bare(l)].length))} ${tint}│${OFF}`),
    `${tint}╰${"─".repeat(w - 2)}╯${OFF}`,
  ]
}

function screen(cols: number, rows: number): string {
  const lines = [
    ...box(cols, [`${ORANGE}✻${OFF} ${BOLD}Welcome to Claude Code${OFF}`, "", `${DIM}/help for help, /status for your current setup${OFF}`, "", `${DIM}cwd: ~/www/channels${OFF}`], ORANGE),
    "",
    `${GREY}>${OFF} kiwi task start T12`,
    "",
    `${GREEN}⏺${OFF} ${BOLD}Bash${OFF}(kiwi task start T12)`,
    `  ${GREY}⎿${OFF}  T12 doing @atlas: Board: group by ask`,
    "",
    `${GREEN}⏺${OFF} ${BOLD}Read${OFF}(ui/src/tasks/board.tsx)`,
    `  ${GREY}⎿${OFF}  Read 412 lines`,
    "",
    `${GREEN}⏺${OFF} ${BOLD}Update${OFF}(ui/src/tasks/board.tsx)`,
    `  ${GREY}⎿${OFF}  Updated ui/src/tasks/board.tsx with 18 additions and 6 removals`,
    `     ${GREY}212${OFF} ${RED}-  const lanes = byStatus(tasks)${OFF}`,
    `     ${GREY}212${OFF} ${GREEN}+  const lanes = byAsk(tasks, channel.asks)${OFF}`,
    "",
    `${ORANGE}✻${OFF} Grouping the board by ask… ${DIM}(38s · ↓ 2.1k tokens · esc to interrupt)${OFF}`,
    "",
  ]
  const prompt = [...box(cols, [`${GREY}>${OFF} `]), `  ${DIM}? for shortcuts${OFF}`]
  const fill = Math.max(0, rows - lines.length - prompt.length)
  return [...lines, ...Array.from({ length: fill }, () => ""), ...prompt].slice(-rows).join("\r\n")
}

function shell(rows: number): string {
  const prompt = `${GREEN}jow@MacBook-Air${OFF} ${BOLD}channels${OFF} %`
  const lines = [
    `${prompt} git status --short`,
    ` ${RED}M${OFF} ui/src/shell/channel.tsx`,
    ` ${RED}M${OFF} ui/src/term/drawer.tsx`,
    `${GREY}??${OFF} notes.md`,
    `${prompt} bun run dev`,
    `${DIM}$ vite${OFF}`,
    `  ${GREEN}➜${OFF}  Local:   http://localhost:5173/`,
    `${GREY}^C${OFF}`,
    `${prompt} `,
  ]
  return lines.slice(-rows).join("\r\n")
}

export async function demoShell(cols: number, rows: number, watch: TermWatch): Promise<TermOpened> {
  const c = Math.max(40, cols)
  const r = Math.max(12, rows)
  return {
    screen: { cols: c, rows: r, seed: shell(r), dead: false },
    link: {
      keys: (text) => watch.out(text.replace(/\r/g, "\r\n")),
      size: () => {},
      close: () => {},
    },
  }
}

export async function demoTerm(cols: number, rows: number, watch: TermWatch): Promise<TermOpened> {
  const c = Math.max(40, cols)
  const r = Math.max(12, rows)
  const promptRow = r - 2
  return {
    screen: { cols: c, rows: r, seed: `${screen(c, r)}\x1b[${promptRow};5H`, dead: false },
    link: {
      keys: (text) => watch.out(text.replace(/\r/g, "\r\n")),
      size: () => {},
      close: () => {},
    },
  }
}
