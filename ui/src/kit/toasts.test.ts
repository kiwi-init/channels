import { afterEach, describe, expect, test } from "bun:test"

import { copyText, kept, onAnnounce, type Toast } from "~/kit/toasts"

const info = (id: number, text = `info ${id}`): Toast => ({ id, text, tone: "info" })
const error = (id: number, text = `error ${id}`): Toast => ({ id, text, tone: "error" })
const ids = (list: Toast[]): number[] => list.map((t) => t.id)

describe("toasts (T1000)", () => {
  test("up to three show, newest last, and a repeat replaces its older copy", () => {
    expect(ids(kept([info(1), info(2)], info(3)))).toEqual([1, 2, 3])
    expect(ids(kept([info(1), info(2), info(3)], info(4)))).toEqual([2, 3, 4])
    expect(ids(kept([info(1, "Copied"), info(2)], info(3, "Copied")))).toEqual([2, 3])
  })

  test("a fourth toast pushes out the oldest info first, so errors stay until dismissed", () => {
    expect(ids(kept([error(1), info(2), info(3)], info(4)))).toEqual([1, 3, 4])
    expect(ids(kept([error(1), error(2), info(3)], error(4)))).toEqual([1, 2, 4])
  })

  test("a new toast still shows when three errors wait: the oldest error goes", () => {
    expect(ids(kept([error(1), error(2), error(3)], info(4)))).toEqual([2, 3, 4])
  })
})

describe("copyText reports whether the text reached the clipboard (#2322)", () => {
  const PROBE = "synthetic-copy-probe"
  const said: { text: string; tone: string }[] = []
  onAnnounce((text, tone) => void said.push({ text, tone }))

  afterEach(() => {
    said.length = 0
    delete (navigator as { clipboard?: unknown }).clipboard
  })

  const withClipboard = (writeText: (text: string) => Promise<void>): void => {
    ;(navigator as { clipboard?: unknown }).clipboard = { writeText }
  }

  test("a write that lands is reported as copied, once", async () => {
    withClipboard((text) => {
      expect(text).toBe(PROBE)
      return Promise.resolve()
    })
    expect(await copyText(PROBE, "copied now")).toBe(true)
    expect(said).toEqual([{ text: "copied now", tone: "info" }])
  })

  test("a rejected write is reported as not copied, and never as copied", async () => {
    withClipboard(() => Promise.reject(new DOMException("denied", "NotAllowedError")))
    expect(await copyText(PROBE, "copied now")).toBe(false)
    expect(said.at(-1)?.tone).toBe("error")
    expect(said.some((s) => s.text === "copied now")).toBe(false)
  })

  test("no clipboard API at all is reported as not copied", async () => {
    expect(await copyText(PROBE, "copied now")).toBe(false)
    expect(said.at(-1)?.tone).toBe("error")
  })
})
