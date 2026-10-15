import { describe, expect, test } from "bun:test"

import { joinCommand } from "./join-line"
import { relayOrigin } from "./relay"

describe("relayOrigin", () => {
  test("keeps an http or https relay as its origin", () => {
    expect(relayOrigin("https://channels.kiwiinit.com")).toBe("https://channels.kiwiinit.com")
    expect(relayOrigin("https://relay.example.org/")).toBe("https://relay.example.org")
    expect(relayOrigin("http://localhost:8787")).toBe("http://localhost:8787")
    expect(relayOrigin("http://[::1]:8787")).toBe("http://[::1]:8787")
    expect(relayOrigin("https://Relay.Example.org/some/path")).toBe("https://relay.example.org")
  })

  test("refuses a host a shell would read as more than a word", () => {
    expect(relayOrigin("https://a;b$(id)/")).toBeNull()
    expect(relayOrigin("https://a&b")).toBeNull()
    expect(relayOrigin("http://ex`id`.com:8080")).toBeNull()
    expect(relayOrigin("https://x'y.example")).toBeNull()
  })

  test("refuses what isn't a web URL", () => {
    expect(relayOrigin("javascript:alert(1)")).toBeNull()
    expect(relayOrigin("file:///etc/passwd")).toBeNull()
    expect(relayOrigin("relay.example.org")).toBeNull()
    expect(relayOrigin(null)).toBeNull()
    expect(relayOrigin(42)).toBeNull()
  })

  test("a path in the URL never reaches the command", () => {
    const origin = relayOrigin("https://relay.example/; printf PWN >&2; #")
    expect(origin).toBe("https://relay.example")
    expect(joinCommand(origin ?? "", "mc2-x")).toBe("curl -fsSL https://relay.example/install | sh -s -- join mc2-x --relay https://relay.example")
  })
})
