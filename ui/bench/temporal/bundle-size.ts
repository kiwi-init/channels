import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { gzipSync } from "node:zlib"

const dist = process.argv[2] ?? join(import.meta.dir, "../../dist")
const html = readFileSync(join(dist, "index.html"), "utf8")
const initial = new Set([...html.matchAll(/<script type="module"[^>]*src="\/([^"]+)"/g), ...html.matchAll(/<link rel="modulepreload"[^>]*href="\/([^"]+)"/g)].map(([, p = ""]) => p))
const every = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? every(join(dir, e.name)) : [join(dir, e.name)]))
const js = every(dist).filter((p) => p.endsWith(".js"))
const sum = { initial: { raw: 0, gzip: 0, files: 0 }, lazy: { raw: 0, gzip: 0, files: 0 } }
const files: { path: string; kind: string; raw: number; gzip: number; temporal: boolean }[] = []
for (const p of js) {
  const buf = readFileSync(p)
  const path = relative(dist, p)
  const kind = initial.has(path) ? "initial" : "lazy"
  const gz = gzipSync(buf, { level: 9 }).length
  const s = sum[kind]
  s.raw += buf.length
  s.gzip += gz
  s.files++
  files.push({ path, kind, raw: buf.length, gzip: gz, temporal: buf.includes("Temporal.Instant") || buf.includes("toZonedDateTimeISO") })
}
console.log(JSON.stringify({ sum, temporalFiles: files.filter((f) => f.temporal), files }))
