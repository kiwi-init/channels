import { expect, test } from "bun:test"

import { detailParts } from "~/panels/task-detail"

test("a title cut for the board shows whole, and the body doesn't repeat it", () => {
  const body = "Channel settings: four save patterns in one dialog, the icon set in two places\n\n**Where.** `a.tsx`.\n\n- one\n- two"
  expect(detailParts("Channel settings: four save patterns in one dialog, the…", body)).toEqual({
    title: "Channel settings: four save patterns in one dialog, the icon set in two places",
    body: "**Where.** `a.tsx`.\n\n- one\n- two",
  })
})

test("a body that opens with the same title drops that line", () => {
  expect(detailParts("Fix the build", "Fix the build\n\nIt fails on Linux.")).toEqual({ title: "Fix the build", body: "It fails on Linux." })
})

test("a body with its own first line stays whole, line breaks kept", () => {
  expect(detailParts("Fix the build", "It fails on Linux.\r\n\r\n- arm64\r\n- x64")).toEqual({ title: "Fix the build", body: "It fails on Linux.\n\n- arm64\n- x64" })
})

test("a first line that only starts like an uncut title is body", () => {
  expect(detailParts("Fix", "Fix the build first.\nThen ship.")).toEqual({ title: "Fix", body: "Fix the build first.\nThen ship." })
})

test("no body", () => {
  expect(detailParts("Fix the build", undefined)).toEqual({ title: "Fix the build", body: "" })
})
