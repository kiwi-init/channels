import { encodeJoinCode, newRoomId } from "@mc/crypto.ts"

import { joinCodeFromInput, joinCodeFromLink } from "./deep-link"

const code = encodeJoinCode({ roomId: newRoomId(), ownerFp: "A".repeat(16) })

describe("joinCodeFromLink, as the web reads it", () => {
  it("reads the code out of the link an invite page opens", () => {
    expect(joinCodeFromLink(`kiwi://join/${code}`)).toBe(code)
  })

  it("takes a trailing slash, an encoded code, a query and surrounding space", () => {
    expect(joinCodeFromLink(`kiwi://join/${code}/`)).toBe(code)
    expect(joinCodeFromLink(`kiwi://join/${encodeURIComponent(code)}`)).toBe(code)
    expect(joinCodeFromLink(`kiwi://join/${code}?from=site`)).toBe(code)
    expect(joinCodeFromLink(` kiwi://join/${code}\n`)).toBe(code)
  })

  it("refuses anything that is not a join link with a join code", () => {
    expect(joinCodeFromLink("kiwi://join/")).toBeNull()
    expect(joinCodeFromLink("kiwi://join/not-a-code")).toBeNull()
    expect(joinCodeFromLink("kiwi://join/%E0%A4%A")).toBeNull()
    expect(joinCodeFromLink(`kiwi://pair/${code}`)).toBeNull()
    expect(joinCodeFromLink(`https://channels.kiwiinit.com/join/${code}`)).toBeNull()
    expect(joinCodeFromLink(`kiwi://join/${code}/more`)).toBeNull()
  })
})

describe("joinCodeFromInput, for the paste-code field", () => {
  it("accepts a bare code, a kiwi link and an invite page link", () => {
    expect(joinCodeFromInput(code)).toBe(code)
    expect(joinCodeFromInput(`  ${code}\n`)).toBe(code)
    expect(joinCodeFromInput(`kiwi://join/${code}`)).toBe(code)
    expect(joinCodeFromInput(`https://channels.kiwiinit.com/join/${code}`)).toBe(code)
    expect(joinCodeFromInput(`https://example.com/join/${code}/?utm=x`)).toBe(code)
  })

  it("refuses empty text, text with spaces, other links and codes that do not decode", () => {
    for (const text of ["", "   ", "join my channel", "not-a-code", "http://example.com/join/" + code, `https://example.com/pair/${code}`, `${code} extra`, "kiwi://join/"]) {
      expect(joinCodeFromInput(text)).toBeNull()
    }
  })
})
