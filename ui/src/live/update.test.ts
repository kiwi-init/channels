import { describe, expect, test } from "bun:test"

import type { UpdateCheckView, UpdateView } from "@kiwi/secrets/secrets.ts"
import { downloadAndRestart, type Updater } from "~/live/update"

const URL = "https://github.com/kiwi-init/channels/releases/tag/v2026.10.8"
const at = (state: UpdateView["state"], extra: Partial<UpdateView> = {}): UpdateView => ({ version: "2026.10.8", state, url: URL, ...extra })

function fake(now: UpdateView | null, checked: UpdateCheckView, installs = true) {
  const calls: string[] = []
  const said: string[] = []
  const listeners = new Set<(u: UpdateView) => void>()
  let state = now
  const b: Updater = {
    getUpdate: async () => state,
    checkUpdate: async () => {
      calls.push("check")
      if (checked.state !== "current" && checked.state !== "failed") state = checked
      return checked
    },
    installUpdate: async () => {
      calls.push("install")
      return installs
    },
    openExternal: async (url: string) => void calls.push(`open ${url}`),
    onUpdate: (cb) => {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
  }
  const emit = (u: UpdateView) => {
    state = u
    for (const cb of [...listeners]) cb(u)
  }
  return { b, calls, said, say: (t: string) => void said.push(t), emit, listening: () => listeners.size }
}

describe("Download and restart", () => {
  test("an update whose download failed downloads again and restarts into it, instead of opening the release page", async () => {
    const f = fake(at("available"), at("downloading"))
    await downloadAndRestart(f.b, f.say)
    expect(f.calls).toEqual(["check"])
    expect(f.said).toEqual(["Downloading Channels 2026.10.8. It restarts when it's in"])
    f.emit(at("ready"))
    expect(f.calls).toEqual(["check", "install"])
    expect(f.listening()).toBe(0)
  })

  test("a download that fails again says so and doesn't restart", async () => {
    const f = fake(at("available"), at("downloading"))
    await downloadAndRestart(f.b, f.say)
    f.emit(at("available"))
    expect(f.calls).toEqual(["check"])
    expect(f.said.at(-1)).toBe("Channels 2026.10.8 didn't download. Try again, or get it from the release page")
    f.emit(at("ready"))
    expect(f.calls).toEqual(["check"])
  })

  test("a download that ends before the listener is in still restarts, once", async () => {
    const f = fake(at("available"), at("ready"))
    await downloadAndRestart(f.b, f.say)
    expect(f.calls).toEqual(["check", "install"])
  })

  test("one already downloading restarts when it's in, without asking GitHub again", async () => {
    const f = fake(at("downloading"), at("downloading"))
    await downloadAndRestart(f.b, f.say)
    f.emit(at("ready"))
    expect(f.calls).toEqual(["install"])
  })

  test("a downloaded one restarts at once", async () => {
    const f = fake(at("ready"), at("ready"))
    await downloadAndRestart(f.b, f.say)
    expect(f.calls).toEqual(["install"])
  })

  test("only an install that can't replace itself, or has no file to download, opens the release page", async () => {
    const blocked = fake(at("available", { blocked: true }), at("available", { blocked: true }))
    await downloadAndRestart(blocked.b, blocked.say)
    expect(blocked.calls).toEqual([`open ${URL}`])
    const noFile = fake(at("available"), at("available"))
    await downloadAndRestart(noFile.b, noFile.say)
    expect(noFile.calls).toEqual(["check", `open ${URL}`])
  })

  test("an install that didn't go in place says so, instead of nothing happening", async () => {
    const f = fake(at("ready"), at("ready"), false)
    await expect(downloadAndRestart(f.b, f.say)).rejects.toThrow("Channels 2026.10.8 didn't go in place. Try again, or get it from the release page")
    const later = fake(at("available"), at("downloading"), false)
    await downloadAndRestart(later.b, later.say)
    later.emit(at("ready"))
    await Promise.resolve()
    await Promise.resolve()
    expect(later.said.at(-1)).toBe("Channels 2026.10.8 didn't go in place. Try again, or get it from the release page")
  })

  test("with no update known yet, it asks GitHub instead of saying it's up to date", async () => {
    const f = fake(null, { state: "current", version: "2026.10.8" })
    await downloadAndRestart(f.b, f.say)
    expect(f.calls).toEqual(["check"])
    expect(f.said).toEqual(["Channels is up to date"])
  })

  test("GitHub not answering is an error the toast shows", async () => {
    const f = fake(at("available"), { state: "failed" })
    await expect(downloadAndRestart(f.b, f.say)).rejects.toThrow("GitHub didn't answer, try again in a minute")
    expect(f.calls).toEqual(["check"])
  })
})
