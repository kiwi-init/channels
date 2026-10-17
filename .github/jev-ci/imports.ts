import { dirname, join, normalize } from "node:path"
import { matches } from "./config.ts"
import { showMany, type Tree } from "./git.ts"

const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"]
const transpilers = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }) }

function resolve(from: string, spec: string, tree: Tree): string | undefined {
  let base: string
  if (spec.startsWith(".")) base = normalize(join(dirname(from), spec))
  else if (spec.startsWith("@mc/")) base = `src/${spec.slice(4)}`
  else if (spec.startsWith("@/") && from.startsWith("web/")) base = `web/src/${spec.slice(2)}`
  else return undefined
  const stems = base.endsWith(".js") ? [base, base.slice(0, -3)] : [base]
  for (const stem of stems) for (const s of SUFFIXES) if (tree.has(stem + s)) return stem + s
  return undefined
}

function specifiers(path: string, text: string): string[] {
  const t = path.endsWith(".tsx") || path.endsWith(".jsx") ? transpilers.tsx : transpilers.ts
  try {
    return t.scanImports(text).map((i) => i.path)
  } catch {
    return []
  }
}

export function importClosure(repo: string, rev: string, tree: Tree, entries: string[]): Set<string> {
  const seen = new Set<string>()
  let layer = [...tree.keys()].filter((p) => matches(entries, p))
  while (layer.length) {
    for (const p of layer) seen.add(p)
    const texts = showMany(repo, rev, layer.filter((p) => SOURCE.test(p)))
    const next = new Set<string>()
    for (const [path, text] of texts)
      for (const spec of specifiers(path, text)) {
        const target = resolve(path, spec, tree)
        if (target && !seen.has(target)) next.add(target)
      }
    layer = [...next]
  }
  return seen
}
