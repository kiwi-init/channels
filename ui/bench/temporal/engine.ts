import { Intl as IdxIntl, Temporal as IdxTemporal } from "temporal-polyfill"
import { Intl as PureIntl, Temporal as PureTemporal } from "temporal-polyfill/implementation"
import { cold, runAll, type Corpus, type Impl } from "./bench.ts"
import { LANGS } from "./langs.ts"
import { dateDaemon, dateUi, temporalDaemon, temporalUi } from "./kernels.ts"

const g = globalThis as { Temporal?: unknown }
export const detect = () => ({
  nativeTemporal: typeof g.Temporal === "object" && g.Temporal !== null,
  polyfillIndexUsesNative: IdxTemporal === g.Temporal,
  timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
  userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
})

export const makers: Record<string, () => Impl> = {
  date: () => ({ name: "date", ui: dateUi(), daemon: dateDaemon }),
  temporal: () => ({ name: "temporal", ui: temporalUi(IdxTemporal, IdxIntl.DateTimeFormat), daemon: temporalDaemon(IdxTemporal) }),
  polyfill: () => ({ name: "polyfill", ui: temporalUi(PureTemporal, PureIntl.DateTimeFormat), daemon: temporalDaemon(PureTemporal) }),
}

export const steady = (corpus: Corpus, opts = { warm: 3, batches: 15, minBatchMs: 30, maxCases: 1500 }) => ({
  detect: detect(),
  ...runAll(
    Object.values(makers).map((m) => m()),
    corpus,
    LANGS,
    opts,
    (s) => console.error(s),
  ),
})

export const coldRun = (impl: string, corpus: Corpus) => {
  const make = makers[impl]
  if (!make) throw new Error(`unknown impl ${impl}`)
  return cold(make, corpus, "en-US")
}
