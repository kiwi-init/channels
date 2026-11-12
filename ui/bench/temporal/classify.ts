import { readFileSync } from "node:fs"

const [listPath = "", outPath = ""] = process.argv.slice(2)
const lines = readFileSync(listPath, "utf8").split("\n").filter(Boolean)

const CAL = /setHours|setDate|setMonth|getHours|getMinutes|getDate\(|getDay\(|getMonth|getFullYear|getUTC|Date\.UTC|toDateString|getTimezoneOffset|toISOString\(\)\.slice\(0, 10\)|DAY\)|\/ DAY|86_?400_?000|startOf|midnight/
const FMT = /toLocale(Date|Time)?String|Intl\.DateTimeFormat|DateTimeFormat|RelativeTimeFormat/
const DUR = /Date\.now\(\)\s*[-+]|[-+]\s*Date\.now\(\)|now\(\)\s*[-+]|Date\.now\(\)\s*[<>]|[<>]=?\s*Date\.now\(\)/

type Kind = "calendar" | "display" | "duration" | "timestamp"
const kindOf = (code: string): Kind => (CAL.test(code) ? "calendar" : FMT.test(code) ? "display" : DUR.test(code) ? "duration" : "timestamp")

const rows = lines.map((l) => {
  const m = /^([^:]+):(\d+):(.*)$/.exec(l)
  return m ? { file: m[1]!, line: Number(m[2]), code: m[3]!.trim(), kind: kindOf(m[3]!) } : null
})
const ok = rows.filter((r) => r !== null)
const counts: Record<string, { lines: number; files: Set<string> }> = {}
for (const r of ok) {
  const c = (counts[r.kind] ??= { lines: 0, files: new Set() })
  c.lines++
  c.files.add(r.file)
}
for (const [k, v] of Object.entries(counts)) console.log(`${k}\t${v.lines} lines\t${v.files.size} files`)
const area = (f: string) => f.split("/").slice(0, f.startsWith("packages/") ? 2 : 1).join("/")
const byArea: Record<string, Record<string, number>> = {}
for (const r of ok) {
  const a = (byArea[area(r.file)] ??= {})
  a[r.kind] = (a[r.kind] ?? 0) + 1
}
console.log(JSON.stringify(byArea))
Bun.write(outPath, ok.map((r) => `${r.kind}\t${r.file}:${r.line}\t${r.code.slice(0, 200)}`).join("\n") + "\n")
