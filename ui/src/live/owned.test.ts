import { expect, test } from "bun:test"

import { ownedOf } from "~/live/owned"

test("a stored answer reads back per channel", () => {
  expect(ownedOf('{"a":true,"b":false}')).toEqual({ a: true, b: false })
})

test("a store from before this field, or an empty one, knows nothing: every channel is unknown", () => {
  expect(ownedOf(null)).toEqual({})
  expect(ownedOf("{}")).toEqual({})
  expect(ownedOf(null).a).toBeUndefined()
})

test("anything that isn't a yes or a no is dropped, and a broken store reads as empty", () => {
  expect(ownedOf('{"a":"yes","b":1,"c":null,"d":true}')).toEqual({ d: true })
  expect(ownedOf("[true]")).toEqual({})
  expect(ownedOf("not json")).toEqual({})
})
