import { describe, expect, test } from "bun:test"

import { encodeJoinCode, newRoomId } from "../../../src/crypto.ts"

import { joinCodeFromLink } from "./deep-link"

describe("joinCodeFromLink", () => {
  const code = encodeJoinCode({ roomId: newRoomId(), ownerFp: "A".repeat(16) })

  test("reads the code out of the link an invite page opens", () => {
    expect(joinCodeFromLink(`kiwi://join/${code}`)).toBe(code)
  })

  test("takes the forms a system may hand over: a trailing slash, an encoded code, a query", () => {
    expect(joinCodeFromLink(`kiwi://join/${code}/`)).toBe(code)
    expect(joinCodeFromLink(`kiwi://join/${encodeURIComponent(code)}`)).toBe(code)
    expect(joinCodeFromLink(`kiwi://join/${code}?from=site`)).toBe(code)
    expect(joinCodeFromLink(` kiwi://join/${code}\n`)).toBe(code)
  })

  test("refuses anything that isn't a join link with a join code", () => {
    expect(joinCodeFromLink("kiwi://join/")).toBeNull()
    expect(joinCodeFromLink("kiwi://join/not-a-code")).toBeNull()
    expect(joinCodeFromLink("kiwi://join/%E0%A4%A")).toBeNull()
    expect(joinCodeFromLink(`kiwi://pair/${code}`)).toBeNull()
    expect(joinCodeFromLink(`https://channels.kiwiinit.com/join/${code}`)).toBeNull()
    expect(joinCodeFromLink(`kiwi://join/${code}/more`)).toBeNull()
  })
})
