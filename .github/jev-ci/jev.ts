import { createHash } from "node:crypto"
import { mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const ENDPOINT = "https://api.typesafe.ai/v1/systemone"
export const MODEL = "jev-1.13.0"
const CACHE = process.env.JEV_CI_CACHE ?? join(tmpdir(), "jev-ci", "answers.json")

type Noul = { type: "noul"; noul: number }
export type Response = { model: string; answers: Record<string, Noul>; usage: { input_tokens: number; output_tokens: number } }
export type Request = { model: string; state: unknown; questions: Record<string, unknown> }

let cache: Record<string, Response> | undefined
async function loadCache() {
  if (cache) return cache
  const f = Bun.file(CACHE)
  return (cache = (await f.exists()) ? await f.json() : {})
}

export async function ask(body: Request): Promise<Response & { cached: boolean }> {
  const c = await loadCache()
  const key = createHash("sha256").update(JSON.stringify(body)).digest("hex")
  const hit = c[key]
  if (hit) return { ...hit, cached: true }
  const apiKey = process.env.TYPESAFE_API_KEY
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not set")
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    if ((res.status === 429 || res.status === 529) && attempt < 4) {
      await Bun.sleep(500 * 2 ** attempt)
      continue
    }
    if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const json = (await res.json()) as Response
    c[key] = json
    mkdirSync(dirname(CACHE), { recursive: true })
    await Bun.write(CACHE, JSON.stringify(c))
    return { ...json, cached: false }
  }
}
