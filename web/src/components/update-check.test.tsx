import { expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { UpdateView } from "../../../desktop/src/bridge.ts"

let current: UpdateView | null = null
mock.module("@/lib/avatars", () => ({ avatarUrl: () => "", robotUrl: () => "", robotFor: () => "blue", harnessUrl: () => "" }))
mock.module("@kiwi/secrets/secrets.ts", () => ({ bridge: () => ({ checkUpdate: async () => ({ state: "failed" }) }) }))
mock.module("@kiwi/app/update.ts", () => ({ useUpdate: () => current, openRelease: () => {}, restartToUpdate: () => {} }))
const { UpdateCheck } = await import("./update-check.tsx")

test("a failed automatic update keeps a manual retry beside the release download", () => {
  current = { state: "available", version: "2026.10.4", url: "https://github.com/kiwi-init/channels/releases/tag/v2026.10.4" }
  const html = renderToStaticMarkup(createElement(UpdateCheck))
  expect(html).toContain("Open release")
  expect(html).toContain("Check for updates")
  expect(html).not.toContain('disabled=""')
})

test("downloading disables another check and a ready update offers restart", () => {
  current = { state: "downloading", version: "2026.10.4", url: "https://github.com/kiwi-init/channels/releases/tag/v2026.10.4" }
  expect(renderToStaticMarkup(createElement(UpdateCheck))).toMatch(/disabled=""[^>]*>Check for updates/)
  current = { ...current, state: "ready" }
  const html = renderToStaticMarkup(createElement(UpdateCheck))
  expect(html).toContain("Restart to update")
  expect(html).not.toContain("Check for updates")
})
