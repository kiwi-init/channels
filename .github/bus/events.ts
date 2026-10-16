import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { summary } from "../jev-ci/github.ts"
import type { Tier } from "./config.ts"
import { enclosing } from "./ladder.ts"
import { must, run } from "./sh.ts"

type Ref = { task: string; branch: string }

export type BusEvent =
  | { what: "bus.collision"; task: string; branch: string; with: Ref; grade: "needs-order"; files: string[]; plan: "stacked"; after: string; p: number }
  | { what: "bus.staged"; task: string; branch: string; sha: string; tier: Tier; hunks: number }
  | { what: "bus.landed"; task: string; sha: string; tier: Tier; files: string[]; symbols: string[]; affects: string[] }
  | { what: "bus.bounced"; task: string; branch: string; reason: string; hunks: number; tried: string[]; note?: string }
  | { what: "bus.red"; task: string; sha: string; jobs: string[]; cause: string; rerun: boolean }

const KIND: Record<BusEvent["what"], string> = {
  "bus.collision": "status",
  "bus.staged": "status",
  "bus.landed": "done",
  "bus.bounced": "blocking",
  "bus.red": "status",
}

export function emit(e: BusEvent): boolean {
  const text = JSON.stringify(e)
  console.log(text)
  summary(`\`\`\`json\n${text}\n\`\`\``)
  const kiwi = process.env.KIWI_BIN
  if (!kiwi || !process.env.KIWI_HOME) return false
  const file = join(mkdtempSync(join(tmpdir(), "bus-event-")), "event.json")
  writeFileSync(file, text)
  const base = [kiwi, "send", "--kind", KIND[e.what], "--file", file]
  const task = /^T\d+$/.test(e.task) ? ["--task", e.task] : ["--main"]
  const sent = run([...base, ...task], process.cwd())
  if (sent.ok || task[0] === "--main") return sent.ok
  return run([...base, "--main"], process.cwd()).ok
}

const NAME = /\b(?:class|interface|function\*?|enum|type|namespace)\s+([\w$]+)|\b(?:const|let)\s+([\w$]+)|^(?:(?:public|private|protected|static|readonly|override|async|get|set)\s+)*(#?[\w$]+)/

const DECLARATION = /^\s*(?:(?:export|default|abstract|declare|public|private|protected|static|override|async)\s+)*(?:(?:class|interface|function\*?|enum|type|namespace|const|let)\s+[\w$]+|\*?#?[\w$]+\s*(?:<[^>]*>)?\(.*\)\s*(?::[^{]*)?\{\s*)$/

const nameOf = (declaration: string) => {
  const m = NAME.exec(declaration.trim().replace(/^(?:(?:export|default|abstract|declare|async)\s+)+/, ""))
  return m?.[1] ?? m?.[2] ?? m?.[3]
}

export function symbols(repo: string, from: string, to: string): string[] {
  const out = new Set<string>()
  const diff = must(["git", "diff", "-U0", "--no-color", "--no-ext-diff", from, to], repo)
  let file = ""
  let text: string | undefined
  for (const line of diff.split("\n")) {
    const f = /^\+\+\+ b\/(.*)$/.exec(line)
    if (f) {
      file = f[1]!
      const shown = run(["git", "show", `${to}:${file}`], repo)
      text = shown.ok ? shown.out : undefined
      continue
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (!h || text === undefined) continue
    const start = Math.max(0, Number(h[1]) - 1)
    const chain = enclosing(text, start).split(" › ").map(nameOf).filter(Boolean)
    const changed = text.split("\n")[start]
    if (changed !== undefined && DECLARATION.test(changed)) {
      const own = nameOf(changed)
      if (own && chain.at(-1) !== own) chain.push(own)
    }
    if (chain.length) out.add(`${file}#${chain.join(".")}`)
  }
  return [...out].sort()
}

export const taskOf = (branch: string) => /^bus\/(T\d+)/.exec(branch)?.[1] ?? branch.replace(/^bus\//, "")
