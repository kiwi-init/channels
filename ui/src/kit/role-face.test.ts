import { describe, expect, test } from "bun:test"
import { ROLES } from "@kiwi/core/personality.ts"
import { faceOf } from "~/kit/role-face"

describe("every agent role has its own face (T904)", () => {
  test("each role an agent can take has its own shape", () => {
    expect(ROLES.map(faceOf)).toEqual([...ROLES])
  })

  test("a custom role, or none, wears the one default face", () => {
    expect([faceOf("designer"), faceOf(undefined), faceOf("__proto__")]).toEqual(["default", "default", "default"])
  })
})
