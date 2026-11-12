import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromium, webkit, type Browser } from "playwright-core"
import { ZONES } from "./corpus.ts"

const dir = import.meta.dir
const [outPath = join(dir, "browsers.json"), only = ""] = process.argv.slice(2)
const built = await Bun.build({ entrypoints: [join(dir, "browser-entry.ts")], target: "browser", format: "iife", minify: true })
if (!built.success) throw new Error(built.logs.join("\n"))
const bundle = await built.outputs[0]!.text()
const corpus = readFileSync(join(dir, "corpus.json"), "utf8")
const COLD_RUNS = 10

async function page(browser: Browser, timezoneId: string) {
  const ctx = await browser.newContext({ timezoneId, locale: "en-US" })
  const p = await ctx.newPage()
  await p.setContent("<!doctype html><title>bench</title>")
  await p.addScriptTag({ content: `window.__corpus = ${corpus};\n${bundle}` })
  return { ctx, p }
}

const engines = [
  { name: "chromium", launch: () => chromium.launch() },
  { name: "webkit", launch: () => (process.env.PW_WS ? webkit.connect(process.env.PW_WS) : webkit.launch()) },
].filter((e) => !only || e.name === only)

const results: Record<string, unknown> = {}
for (const engine of engines) {
  const browser = await engine.launch()
  const version = browser.version()
  const steady: Record<string, unknown> = {}
  for (const zone of ZONES) {
    const { ctx, p } = await page(browser, zone)
    steady[zone] = await p.evaluate(() => {
      const w = window as unknown as { __bench: { steady: (c: unknown) => unknown }; __corpus: unknown }
      return w.__bench.steady(w.__corpus)
    })
    await ctx.close()
    console.error(`${engine.name} ${zone} done`)
  }
  const cold: Record<string, unknown[]> = { date: [], temporal: [], polyfill: [] }
  for (let i = 0; i < COLD_RUNS; i++)
    for (const impl of Object.keys(cold)) {
      const { ctx, p } = await page(browser, "America/New_York")
      cold[impl]!.push(
        await p.evaluate((name) => {
          const w = window as unknown as { __bench: { coldRun: (n: string, c: unknown) => unknown }; __corpus: unknown }
          return w.__bench.coldRun(name, w.__corpus)
        }, impl),
      )
      await ctx.close()
    }
  results[engine.name] = { version, steady, cold }
  writeFileSync(outPath, JSON.stringify(results))
  await browser.close()
}
writeFileSync(outPath, JSON.stringify(results))
console.error(`wrote ${outPath}`)
