import { readFileSync } from "node:fs"

interface T {
  kernel: string
  impl: string
  cases: number
  nsPerCall: { median: number; p10: number; p90: number; min: number; max: number }
}
interface Steady {
  detect: Record<string, unknown>
  counts: { kernel: string; impl: string; total: number; equal: number }[]
  diffs: { kernel: string; impl: string; input: unknown; date: string; other: string }[]
  timings: T[]
}
interface Cold {
  setupUs: number
  firstCallUs: Record<string, number>
}
interface EngineRun {
  version: string
  steady: Record<string, Steady>
  cold: Record<string, Cold[]>
}

const [bunPath = "", browsersPath = ""] = process.argv.slice(2)
const engines: Record<string, EngineRun> = {}
if (bunPath) engines.bun = JSON.parse(readFileSync(bunPath, "utf8"))
if (browsersPath) Object.assign(engines, JSON.parse(readFileSync(browsersPath, "utf8")))

const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
}
const f = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(1))

for (const [name, e] of Object.entries(engines)) {
  console.log(`\n## ${name} ${e.version}`)
  const first = Object.values(e.steady)[0]
  console.log(`detect: ${JSON.stringify(first?.detect)}`)
  console.log("\n| kernel | impl | cases timed (per zone) | median ns/call (median over zones) | worst zone p10-p90 | ratio vs date |")
  console.log("|---|---|---|---|---|---|")
  const kernels = [...new Set(first?.timings.map((t) => t.kernel))]
  for (const k of kernels) {
    const dateMed = med(Object.values(e.steady).map((s) => s.timings.find((t) => t.kernel === k && t.impl === "date")!.nsPerCall.median))
    for (const impl of ["date", "temporal", "polyfill"]) {
      const ts = Object.values(e.steady).map((s) => s.timings.find((t) => t.kernel === k && t.impl === impl)!)
      const m = med(ts.map((t) => t.nsPerCall.median))
      const lo = Math.min(...ts.map((t) => t.nsPerCall.p10))
      const hi = Math.max(...ts.map((t) => t.nsPerCall.p90))
      const cases = `${Math.min(...ts.map((t) => t.cases))}-${Math.max(...ts.map((t) => t.cases))}`
      console.log(`| ${k} | ${impl} | ${cases} | ${f(m)} | ${f(lo)}-${f(hi)} | ${(m / dateMed).toFixed(2)}x |`)
    }
  }
  console.log("\ncold (TZ America/New_York, median of fresh runs, microseconds): setup, then first call per kernel")
  console.log("| impl | runs | setup | clock | ago | day | sameDay | daemonClock |")
  console.log("|---|---|---|---|---|---|---|---|")
  for (const [impl, runs] of Object.entries(e.cold)) {
    const fc = (k: string) => f(med(runs.map((r) => r.firstCallUs[k]!)))
    console.log(`| ${impl} | ${runs.length} | ${f(med(runs.map((r) => r.setupUs)))} | ${fc("clock")} | ${fc("ago")} | ${fc("day")} | ${fc("sameDay")} | ${fc("daemonClock")} |`)
  }
  console.log("\ncorrectness: unequal outputs per zone (kernel/impl: unequal of total)")
  for (const [zone, s] of Object.entries(e.steady)) {
    const bad = s.counts.filter((c) => c.equal !== c.total).map((c) => `${c.kernel}/${c.impl}: ${c.total - c.equal} of ${c.total}`)
    console.log(`- ${zone}: ${bad.length ? bad.join("; ") : "all equal"}`)
  }
}

const iso = (ms: number, zone: string) => Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(zone).toString({ smallestUnit: "millisecond", timeZoneName: "never" })
console.log("\n## correctness differences (deduplicated by kernel, zone, at, now; en-US output shown)")
console.log("| kernel | zone | at (local) | now (local) | Date/Intl | Temporal | engines/impls | langs |")
console.log("|---|---|---|---|---|---|---|---|")
const seen = new Map<string, { row: string[]; who: Set<string>; langs: Set<string> }>()
const groups = new Map<string, { n: number; langs: Set<string>; zones: Set<string>; examples: string[] }>()
for (const [name, e] of Object.entries(engines))
  for (const [zone, s] of Object.entries(e.steady))
    for (const d of s.diffs) {
      if (d.kernel !== "day") {
        const inp = d.input as { lang?: string; at: number }
        const gk = `${d.kernel} | ${name}/${d.impl}`
        let g = groups.get(gk)
        if (!g) groups.set(gk, (g = { n: 0, langs: new Set(), zones: new Set(), examples: [] }))
        g.n++
        g.zones.add(zone)
        if (inp.lang) g.langs.add(inp.lang)
        if (g.examples.length < 3) g.examples.push(`${inp.lang ?? ""} ${iso(inp.at, zone)}: Date/Intl "${d.date}" vs "${d.other}"`)
        continue
      }
      const inp = d.input as { lang?: string; at: number; now: number }
      const key = `${d.kernel}|${zone}|${inp.at}|${inp.now}`
      let r = seen.get(key)
      if (!r) seen.set(key, (r = { row: [d.kernel, zone, iso(inp.at, zone), iso(inp.now, zone), d.date, d.other], who: new Set(), langs: new Set() }))
      if (!inp.lang || inp.lang === "en-US") {
        r.row[4] = d.date
        r.row[5] = d.other
      }
      r.who.add(`${name}/${d.impl}`)
      if (inp.lang) r.langs.add(inp.lang)
    }
for (const r of seen.values()) console.log(`| ${r.row.join(" | ")} | ${[...r.who].join(", ")} | ${[...r.langs].join(", ")} |`)
console.log(`total distinct differing inputs: ${seen.size}`)
console.log("\n### other kernels: grouped differences")
console.log("| kernel / engine-impl | differing outputs (all zones) | langs | zones | examples |")
console.log("|---|---|---|---|---|")
groups.forEach((g, k) => console.log(`| ${k} | ${g.n} | ${[...g.langs].join(", ")} | ${g.zones.size} | ${g.examples.join("; ")} |`))
