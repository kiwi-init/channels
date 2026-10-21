import { describe, expect, test } from "bun:test"

import { fitTabs } from "./tab-fit"

const room = (widths: number[], room: number) => ({ widths, room, more: 80, gap: 4 })

describe("the channel tabs that fit the bar", () => {
  test("every tab shows when they all fit, with no room kept for More", () => {
    expect(fitTabs(room([100, 100, 100], 308), 0)).toEqual([0, 1, 2])
  })
  test("past the edge, tabs show in order and the rest go under More, which keeps its room", () => {
    expect(fitTabs(room([100, 100, 100, 100], 300), 0)).toEqual([0, 1])
  })
  test("the open channel always has a tab: it takes the last place that fits", () => {
    expect(fitTabs(room([100, 100, 100, 100, 100], 400), 4)).toEqual([0, 1, 4])
    expect(fitTabs(room([100, 100, 100, 100, 160], 400), 4)).toEqual([0, 4])
  })
  test("a bar too narrow for anything still shows the open channel", () => {
    expect(fitTabs(room([100, 100, 100], 120), 2)).toEqual([2])
    expect(fitTabs(room([100, 100, 100], 120), -1)).toEqual([])
  })
})
