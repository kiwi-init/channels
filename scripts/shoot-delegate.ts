import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright-core"

const base = process.argv[2] ?? "http://localhost:5207/mock.html"
const out = process.argv[3] ?? "./shots"
const only = process.argv[4]?.split(",")
mkdirSync(out, { recursive: true })

const SHOTS: { name: string; query: string; width: number; height: number }[] = [
  { name: "a-dispatch-auto", query: "d=a", width: 1440, height: 900 },
  { name: "a-dispatch-drag", query: "d=a&mode=hold&drag=1", width: 1440, height: 900 },
  { name: "a-dispatch-phone", query: "d=a", width: 390, height: 844 },
  { name: "b-handoff", query: "d=b", width: 1440, height: 900 },
  { name: "b-handoff-choose", query: "d=b&choose=1", width: 1440, height: 900 },
  { name: "b-handoff-phone", query: "d=b", width: 390, height: 844 },
  { name: "c-bottlenecks", query: "d=c", width: 1440, height: 1000 },
  { name: "c-bottlenecks-phone", query: "d=c", width: 390, height: 844 },
]

const browser = await chromium.launch()
try {
  for (const theme of ["light", "dark"]) {
    for (const s of SHOTS) {
      const file = `${s.name}-${theme}`
      if (only && !only.some((o) => file.includes(o))) continue
      const page = await browser.newPage({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 2 })
      page.on("pageerror", (e) => console.log(`${file}: page error ${e.message}`))
      page.on("console", (m) => m.type() === "error" && console.log(`${file}: console ${m.text()}`))
      await page.goto(`${base}?${s.query}&theme=${theme}`)
      await page
        .locator("h2, h3")
        .filter({ hasText: /Hand out work|Up next|What frees the crowd/ })
        .first()
        .waitFor({ timeout: 20000 })
      await page.waitForTimeout(400)
      await page.screenshot({ path: join(out, `${file}.png`) })
      console.log(`shot ${file}`)
      await page.close()
    }
  }
} finally {
  await browser.close()
}
