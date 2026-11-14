import { join } from "node:path"
import { webkit } from "playwright-core"
const dist = "ui/dist"
const shot = process.argv[2] ?? "thread-doc"
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) { const p = decodeURIComponent(new URL(req.url).pathname); const f = Bun.file(join(dist, p === "/" || !p.includes(".") ? "index.html" : p)); return (await f.exists()) ? new Response(f) : new Response("nf", { status: 404 }) } })
const browser = await webkit.launch()
const [W, H] = (process.argv[3] ?? "1440x900").split("x").map(Number); const page = await browser.newPage({ viewport: { width: W!, height: H! } })
await page.addInitScript(() => {
  const log: string[] = []
  ;(window as any).__log = log
  const t0 = performance.now()
  let last = ""
  const name = (c: Element) => (c as HTMLElement).dataset.seq ?? (c.className || c.tagName).toString().split(" ")[0]
  const tick = () => {
    const f = document.querySelector<HTMLElement>(".feed")
    if (f) {
      const rows = [...(f.querySelector(".feed-list")?.children ?? [])].map((c) => `${name(c)}=${Math.round((c as HTMLElement).offsetHeight)}`).join(",")
      const s = `${Math.round(f.scrollTop)}/${f.scrollHeight}/${f.clientHeight} | ${[...f.children].map((c) => `${name(c)}=${Math.round((c as HTMLElement).offsetHeight)}`).join(",")} | ${rows}`
      if (s !== last) { log.push(`${Math.round(performance.now() - t0)}ms ${s} || fonts=${document.fonts.status}:${[...document.fonts].filter((x) => x.status !== "unloaded").map((x) => x.family + '=' + x.status).join(',')} plain=${f.querySelectorAll('.md-plain').length}`); last = s }
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  document.addEventListener("scroll", (e) => { const t = e.target as HTMLElement; if (t?.classList?.contains("feed")) log.push(`${Math.round(performance.now() - t0)}ms scroll-event top=${Math.round(t.scrollTop)}`) }, true)
})
await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`)
await page.waitForSelector(".feed")
await page.waitForTimeout(4500)
console.log((await page.evaluate(() => (window as any).__log)).join("\n"))
console.log(await page.evaluate(() => `fonts: ${[...document.fonts].filter((x) => x.status === "loaded").map((x) => x.family).join(",")}`))
const row = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".feed-list > [data-seq]")].slice(-4).map((r) => `${r.dataset.seq}: ${r.offsetHeight}`).join("\n"))
console.log(row)
await browser.close(); server.stop()
