import { holdJoin, takeJoin } from "./pendingJoin"

describe("a join link opened before first run", () => {
  it("is kept once and handed back once", () => {
    expect(takeJoin()).toBeNull()
    holdJoin("mc2-abc")
    expect(takeJoin()).toBe("mc2-abc")
    expect(takeJoin()).toBeNull()
  })

  it("keeps the latest link", () => {
    holdJoin("mc2-one")
    holdJoin("mc2-two")
    expect(takeJoin()).toBe("mc2-two")
  })
})
