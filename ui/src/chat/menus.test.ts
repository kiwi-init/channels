import { describe, expect, test } from "bun:test"

import { webLinkAt } from "~/chat/menus"

const target = (href: string | null) => ({ closest: () => (href === null ? null : { getAttribute: () => href }) })

describe("a right-click on a link (T974)", () => {
  test("web and mail links count", () => {
    expect(webLinkAt(target("https://example.com"))).toBe("https://example.com")
    expect(webLinkAt(target("mailto:a@example.com"))).toBe("mailto:a@example.com")
  })

  test("the app's own mention, task and message links don't", () => {
    expect(webLinkAt(target("kiwi-mention:ana"))).toBeNull()
    expect(webLinkAt(target("kiwi-task:7"))).toBeNull()
    expect(webLinkAt(target("javascript:alert(1)"))).toBeNull()
  })

  test("nothing under the pointer is no link", () => {
    expect(webLinkAt(target(null))).toBeNull()
    expect(webLinkAt(null)).toBeNull()
  })
})
