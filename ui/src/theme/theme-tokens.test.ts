import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CHANNELS_DARK, CHANNELS_LIGHT } from "~/theme/channels"

import base from "./theme-tokens-base.json"

const TOKENS_CSS = join(import.meta.dir, "../styles/tokens.css")
const SCRIPT = join(import.meta.dir, "../../../scripts/theme-tokens.ts")

const run = (file: string, ...more: string[]) => {
  const p = Bun.spawnSync(["bun", SCRIPT, "--css", file, ...more], { stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, err: p.stderr.toString() }
}

function withCopy(css: string, check: (file: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-theme-tokens-"))
  try {
    const file = join(dir, "tokens.css")
    writeFileSync(file, css)
    check(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("built-in theme colours in tokens.css come from channels.ts (#2407)", () => {
  test("channels.ts reproduces every colour of the original tokens.css blocks, token by token", () => {
    expect(base.base).toMatch(/^[0-9a-f]{40}$/)
    expect(CHANNELS_DARK.colors).toEqual(base.dark)
    expect(CHANNELS_LIGHT.colors).toEqual(base.light)
    expect(CHANNELS_LIGHT.colors).toEqual(base["auto-light"])
  })

  test("today's tokens.css passes the check, and rewriting it from channels.ts changes no byte", () => {
    const original = readFileSync(TOKENS_CSS, "utf8")
    expect(run(TOKENS_CSS).code).toBe(0)
    withCopy(original, (file) => {
      expect(run(file, "--write").code).toBe(0)
      expect(readFileSync(file, "utf8")).toBe(original)
    })
  })

  test("a hand edit that drifts from channels.ts fails the check, which names it and leaves the file as edited", () => {
    const original = readFileSync(TOKENS_CSS, "utf8")
    const light = original.indexOf(':root[data-theme="light"] {')
    const edited = original.slice(0, light) + original.slice(light).replace(`--c-teal: ${CHANNELS_LIGHT.colors["c-teal"]};`, "--c-teal: #000001;")
    expect(edited).not.toBe(original)
    withCopy(edited, (file) => {
      const checked = run(file)
      expect(checked.code).toBe(1)
      expect(checked.err).toContain(`light --c-teal: tokens.css has #000001, channels.ts has ${CHANNELS_LIGHT.colors["c-teal"]}`)
      expect(readFileSync(file, "utf8")).toBe(edited)
      expect(run(file, "--write").code).toBe(0)
      expect(readFileSync(file, "utf8")).toBe(original)
    })
  })

  test("a missing or doubled colour declaration fails the check and can't be written over", () => {
    const original = readFileSync(TOKENS_CSS, "utf8")
    const scrim = `  --scrim: ${CHANNELS_DARK.colors.scrim};\n`
    const link = `  --link: ${CHANNELS_DARK.colors.link};\n`
    for (const [css, token] of [
      [original.replace(scrim, ""), "scrim"],
      [original.replace(link, link + link), "link"],
    ] as const) {
      withCopy(css, (file) => {
        expect(run(file)).toEqual({ code: 1, err: expect.stringContaining(`dark --${token}: tokens.css has no single declaration`) })
        expect(run(file, "--write").code).toBe(1)
        expect(readFileSync(file, "utf8")).toBe(css)
      })
    }
  })
})
