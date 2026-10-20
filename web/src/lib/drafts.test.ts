import { describe, expect, test } from "bun:test"

import { draftOf, keepDraft } from "./drafts"

describe("a draft outlives its composer", () => {
  test("what was typed, or an image, is kept per place until it's emptied; no key keeps nothing", () => {
    keepDraft("room-a:main", { body: "half a thought", files: [] })
    keepDraft("room-a:dm:ana", { body: "", files: [{ name: "a.png", mime: "image/png", data: "data:," }] })
    expect(draftOf("room-a:main")).toEqual({ body: "half a thought", files: [] })
    expect(draftOf("room-a:dm:ana")?.files).toHaveLength(1)
    expect(draftOf("room-b:main")).toBeUndefined()
    keepDraft("room-a:main", { body: "", files: [] })
    expect(draftOf("room-a:main")).toBeUndefined()
    keepDraft(undefined, { body: "lost", files: [] })
    expect(draftOf(undefined)).toBeUndefined()
  })
})
