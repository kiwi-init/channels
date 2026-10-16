import { matches } from "../jev-ci/config.ts"
import type { Typecheck } from "./config.ts"
import { clip, run } from "./sh.ts"

export type Problem = { file: string; what: string }

const MARKER = /^(<{7}|\|{7}|>{7})( |$)/m
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/

export const hasMarkers = (text: string) => MARKER.test(text)

export function parseError(file: string, text: string): string | undefined {
  try {
    if (file.endsWith(".json")) JSON.parse(text)
    else if (CODE.test(file)) new Bun.Transpiler({ loader: /x$/.test(file) ? "tsx" : "ts" }).transformSync(text)
    return undefined
  } catch (e) {
    return String(e).split("\n")[0]!.slice(0, 300)
  }
}

function codeOnly(text: string): string[] {
  let out = ""
  let state: "code" | "line" | "block" | "'" | '"' | "`" = "code"
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    const n = text[i + 1]
    if (c === "\n") {
      if (state === "line") state = "code"
      out += "\n"
    } else if (state === "code") {
      if (c === "/" && n === "/") state = "line"
      else if (c === "/" && n === "*") (state = "block"), i++
      else if (c === "'" || c === '"' || c === "`") (state = c), (out += c)
      else out += c
    } else if (state === "block") {
      if (c === "*" && n === "/") (state = "code"), i++
    } else if (state !== "line") {
      if (c === "\\") i++
      else if (c === state) (state = "code"), (out += c)
    }
  }
  return out.split("\n")
}

const FIELD = /^\s*(?:(?:public|private|protected|static|readonly|declare|override|accessor)\s+)*(#?[A-Za-z_$][\w$]*)\s*[?!]?\s*(?::|=[^=>]|;)/
const METHOD = /^\s*(?:(?:public|private|protected|static|override|async)\s+)*(?:get\s+|set\s+)?\*?(#?[A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(.*\)\s*(?::[^{]*)?\{\s*$/

export function duplicateMembers(text: string): string[] {
  const stack: { cls: string | undefined; parens: number; names: Map<string, number> }[] = [{ cls: undefined, parens: 0, names: new Map() }]
  const dupes: string[] = []
  let parens = 0
  for (const line of codeOnly(text)) {
    const top = stack[stack.length - 1]!
    if (top.cls && parens === top.parens) {
      const method = line.match(METHOD)
      const name = (method ?? line.match(FIELD))?.[1]
      if (name && !["constructor", "return", "if", "for", "while", "switch", "catch"].includes(name)) {
        const accessor = method && /^\s*(?:\w+\s+)*(get|set)\s/.exec(line)?.[1]
        const key = `${/^\s*(?:\w+\s+)*static\s/.test(line) ? "static " : ""}${accessor ?? "member"}:${name}`
        const seen = (top.names.get(key) ?? 0) + 1
        top.names.set(key, seen)
        if (seen === 2) dupes.push(`${top.cls}.${name}`)
      }
    }
    const cls = /\bclass\s+([A-Za-z_$][\w$]*)[^{]*\{/.exec(line)?.[1]
    let first = true
    for (const c of line) {
      if (c === "(") parens++
      else if (c === ")") parens = Math.max(0, parens - 1)
      else if (c === "{") {
        stack.push({ cls: first ? cls : undefined, parens, names: new Map() })
        first = false
      } else if (c === "}" && stack.length > 1) stack.pop()
    }
  }
  return dupes
}

export function checkFile(file: string, text: string, before: string | undefined): Problem[] {
  const problems: Problem[] = []
  if (hasMarkers(text)) problems.push({ file, what: "conflict markers are left" })
  const err = parseError(file, text)
  if (err) problems.push({ file, what: `does not parse: ${err}` })
  if (!err && CODE.test(file)) {
    const old = new Set(before === undefined ? [] : duplicateMembers(before))
    for (const d of duplicateMembers(text)) if (!old.has(d)) problems.push({ file, what: `${d} is declared twice` })
  }
  return problems
}

export type Typechecked = { ok: boolean; ran: string[]; output: string }

export function typecheck(dir: string, touched: string[], checks: Typecheck[]): Typechecked {
  const due = checks.filter((t) => touched.some((f) => matches(t.when, f)))
  const installed = new Set<string>()
  const ran: string[] = []
  for (const t of due) {
    for (const d of new Set([".", t.dir ?? "."])) {
      if (installed.has(d)) continue
      installed.add(d)
      const r = run(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], `${dir}/${d}`)
      if (!r.ok) return { ok: false, ran, output: `bun install in ${d}: ${clip(r.err || r.out, 40)}` }
    }
    const label = `${t.dir ? `cd ${t.dir} && ` : ""}${t.run.join(" ")}`
    ran.push(label)
    const r = run(t.run, `${dir}/${t.dir ?? "."}`)
    if (!r.ok) return { ok: false, ran, output: `${label}:\n${clip((r.out + r.err).trim(), 60)}` }
  }
  return { ok: true, ran, output: "" }
}
