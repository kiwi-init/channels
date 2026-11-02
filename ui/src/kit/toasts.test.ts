import { describe, expect, test } from "bun:test"

import { kept, type Toast } from "~/kit/toasts"

const info = (id: number, text = `info ${id}`): Toast => ({ id, text, tone: "info" })
const error = (id: number, text = `error ${id}`): Toast => ({ id, text, tone: "error" })
const ids = (list: Toast[]): number[] => list.map((t) => t.id)

describe("toasts (T1000)", () => {
  test("up to three show, newest last, and a repeat replaces its older copy", () => {
    expect(ids(kept([info(1), info(2)], info(3)))).toEqual([1, 2, 3])
    expect(ids(kept([info(1), info(2), info(3)], info(4)))).toEqual([2, 3, 4])
    expect(ids(kept([info(1, "Copied"), info(2)], info(3, "Copied")))).toEqual([2, 3])
  })

  test("a fourth toast pushes out the oldest info first, so errors stay until dismissed", () => {
    expect(ids(kept([error(1), info(2), info(3)], info(4)))).toEqual([1, 3, 4])
    expect(ids(kept([error(1), error(2), info(3)], error(4)))).toEqual([1, 2, 4])
  })

  test("a new toast still shows when three errors wait: the oldest error goes", () => {
    expect(ids(kept([error(1), error(2), error(3)], info(4)))).toEqual([2, 3, 4])
  })
})
