import type { ClockCase, DaemonKernel, UiKernels } from "./kernels.ts"

export interface Impl {
  name: string
  ui: UiKernels
  daemon: DaemonKernel
}

export interface Corpus {
  pairs: { at: number; now: number }[]
  clockCases: ClockCase[]
}

type Call = () => string

interface Task {
  kernel: string
  inputs: unknown[]
  calls: (impl: Impl) => Call[]
}

export interface Diff {
  kernel: string
  impl: string
  input: unknown
  date: string
  other: string
}

export interface Timing {
  kernel: string
  impl: string
  cases: number
  equalCases: number
  nsPerCall: { median: number; p10: number; p90: number; min: number; max: number }
}

const now = (): number => performance.now()

function tasks(corpus: Corpus, langs: readonly string[]): Task[] {
  const lp = langs.flatMap((lang) => corpus.pairs.map((p) => ({ lang, ...p })))
  return [
    { kernel: "clock", inputs: lp, calls: (i) => lp.map((x) => () => i.ui.clock(x.lang, x.at)) },
    { kernel: "ago", inputs: lp, calls: (i) => lp.map((x) => () => i.ui.ago(x.lang, x.at, x.now)) },
    { kernel: "day", inputs: lp, calls: (i) => lp.map((x) => () => i.ui.day(x.lang, x.at, x.now)) },
    { kernel: "sameDay", inputs: corpus.pairs, calls: (i) => corpus.pairs.map((x) => () => i.ui.sameDay(x.at, x.now)) },
    { kernel: "daemonClock", inputs: corpus.clockCases, calls: (i) => corpus.clockCases.map((c) => () => i.daemon(c)) },
  ]
}

const quant = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) * q
  const lo = Math.floor(i)
  return s[lo]! + (s[Math.ceil(i)]! - s[lo]!) * (i - lo)
}

export let sink = 0

function pass(fs: Call[]): number {
  let n = 0
  for (const f of fs) n += f().length
  return n
}

export function runAll(impls: Impl[], corpus: Corpus, langs: readonly string[], opts: { warm: number; batches: number; minBatchMs: number; maxCases: number }, log: (s: string) => void = () => {}) {
  const base = impls.find((i) => i.name === "date")
  if (!base) throw new Error("date impl required")
  const diffs: Diff[] = []
  const timings: Timing[] = []
  const counts: { kernel: string; impl: string; total: number; equal: number }[] = []
  for (const task of tasks(corpus, langs)) {
    const ref = task.calls(base).map((f) => f())
    const equalAll = new Set(ref.map((_, k) => k))
    for (const impl of impls) {
      if (impl === base) continue
      const out = task.calls(impl).map((f) => {
        try {
          return f()
        } catch (err) {
          return `THROW ${String(err)}`
        }
      })
      let eq = 0
      out.forEach((o, k) => {
        if (o === ref[k]) eq++
        else {
          equalAll.delete(k)
          diffs.push({ kernel: task.kernel, impl: impl.name, input: task.inputs[k], date: ref[k]!, other: o })
        }
      })
      counts.push({ kernel: task.kernel, impl: impl.name, total: out.length, equal: eq })
    }
    const equal = [...equalAll]
    const stride = Math.max(1, Math.ceil(equal.length / opts.maxCases))
    const keep = equal.filter((_, i) => i % stride === 0)
    log(`${task.kernel}: ${equal.length} equal cases, timing ${keep.length}`)
    const fns = impls.map((impl) => {
      const all = task.calls(impl)
      return keep.map((k) => all[k]!)
    })
    const repsOf = fns.map((fs) => {
      const t0 = now()
      sink += pass(fs)
      return Math.max(1, Math.ceil(opts.minBatchMs / Math.max(now() - t0, 0.001)))
    })
    const samples: number[][] = impls.map(() => [])
    for (let b = 0; b < opts.warm + opts.batches; b++)
      impls.forEach((_, j) => {
        const jj = b % 2 === 0 ? j : impls.length - 1 - j
        const fs = fns[jj]!
        const s = now()
        const reps = repsOf[jj]!
        for (let r = 0; r < reps; r++) sink += pass(fs)
        const el = now() - s
        if (b >= opts.warm) samples[jj]!.push((el * 1e6) / (reps * fs.length))
      })
    impls.forEach((impl, j) => {
      const xs = samples[j]!
      timings.push({ kernel: task.kernel, impl: impl.name, cases: keep.length, equalCases: equal.length, nsPerCall: { median: quant(xs, 0.5), p10: quant(xs, 0.1), p90: quant(xs, 0.9), min: Math.min(...xs), max: Math.max(...xs) } })
    })
  }
  return { counts, diffs, timings, sink }
}

export function cold(make: () => Impl, corpus: Corpus, lang: string) {
  const s0 = now()
  const impl = make()
  const setupUs = (now() - s0) * 1000
  const p = corpus.pairs[0]!
  const c = corpus.clockCases[0]!
  const first: Record<string, number> = {}
  const time = (k: string, f: () => string) => {
    const s = now()
    sink += f().length
    first[k] = (now() - s) * 1000
  }
  time("clock", () => impl.ui.clock(lang, p.at))
  time("ago", () => impl.ui.ago(lang, p.at, p.now + 30 * 86_400_000))
  time("day", () => impl.ui.day(lang, p.at, p.now + 30 * 86_400_000))
  time("sameDay", () => impl.ui.sameDay(p.at, p.now))
  time("daemonClock", () => impl.daemon(c))
  return { setupUs, firstCallUs: first, sink }
}
