import { describe, expect, test } from "bun:test"
import type { Where } from "~/model"
import { historyStep, navigate, startNav, type Go, type Nav } from "~/nav"
import { keepPlace, keepSpot, spotKey, whereOf } from "~/places"

const room = (id: string): Where => ({ kind: "room", room: id })
const general = room("general")

const run = (nav: Nav, ...goes: Go[]): Nav => goes.reduce(navigate, nav)
const at = (nav: Nav) => ({ channel: nav.channel, where: nav.where, tab: nav.tab })

describe("back and forward walk the places you were (T978)", () => {
  test("⌘[ returns to the room you left, at the spot you left it, and ⌘] goes forward again", () => {
    keepSpot(spotKey("a", general), { seq: 40, offset: -12 })
    const there = run(startNav("a"), { to: "where", where: room("design") })
    expect(there.back.map((p) => p.where)).toEqual([general])
    const back = navigate(there, { to: "history", step: "back" })
    expect(at(back)).toEqual({ channel: "a", where: general, tab: "chat" })
    expect(back.restore).toEqual({ seq: 40, offset: -12 })
    expect(back.visit).toBe(there.visit + 1)
    const forward = navigate(back, { to: "history", step: "forward" })
    expect(at(forward)).toEqual({ channel: "a", where: room("design"), tab: "chat" })
    expect(forward.ahead).toEqual([])
    expect(forward.back.map((p) => p.where)).toEqual([general])
  })

  test("a search jump inside the room you're in is a step too, so ⌘[ undoes it", () => {
    keepSpot(spotKey("a", room("design")), { seq: 7, offset: 3 })
    const jumped = run(startNav("a"), { to: "where", where: room("design") }, { to: "where", where: room("design"), jump: true })
    expect(jumped.back.map((p) => p.where)).toEqual([general, room("design")])
    const back = navigate(jumped, { to: "history", step: "back" })
    expect(at(back).where).toEqual(room("design"))
    expect(back.restore).toEqual({ seq: 7, offset: 3 })
  })

  test("opening the same room again without a jump adds nothing", () => {
    const nav = run(startNav("a"), { to: "where", where: general }, { to: "panel", panel: { kind: "channel" } }, { to: "where", where: general })
    expect(nav.back).toEqual([])
  })

  test("a notification in another channel is one step: ⌘[ goes straight back, not through that channel's last room", () => {
    keepPlace("b", { where: room("ops"), tab: "chat" })
    const nav = run(startNav("a"), { to: "channel", code: "b", jump: true }, { to: "where", where: room("alerts"), replace: true })
    expect(at(nav)).toEqual({ channel: "b", where: room("alerts"), tab: "chat" })
    expect(nav.back.map((p) => [p.channel, p.where])).toEqual([["a", general]])
  })

  test("a notification in another room of the same channel is one step too", () => {
    const nav = run(startNav("a"), { to: "channel", code: "a", jump: true }, { to: "where", where: room("alerts"), replace: true })
    expect(nav.back.map((p) => [p.channel, p.where])).toEqual([["a", general]])
  })

  test("going somewhere new drops the places ahead", () => {
    const back = run(startNav("a"), { to: "where", where: room("design") }, { to: "history", step: "back" })
    expect(back.ahead).toHaveLength(1)
    expect(navigate(back, { to: "tab", tab: "specs" }).ahead).toEqual([])
  })

  test("tabs are places, settings isn't, and nothing happens at either end", () => {
    const nav = run(startNav("a"), { to: "tab", tab: "agents" }, { to: "settings" }, { to: "back" })
    expect(nav.back.map((p) => p.tab)).toEqual(["chat"])
    const start = startNav("a")
    expect(navigate(start, { to: "history", step: "back" })).toBe(start)
    expect(navigate(start, { to: "history", step: "forward" })).toBe(start)
  })

  test("going back to another channel closes that channel's panel and terminal", () => {
    const nav = run(startNav("a"), { to: "channel", code: "c" }, { to: "panel", panel: { kind: "channel" } }, { to: "term", term: { kind: "you" } }, { to: "history", step: "back" })
    expect(nav.channel).toBe("a")
    expect(nav.panel).toBeNull()
    expect(nav.term).toBeUndefined()
  })

  test("the history keeps the last 50 places", () => {
    const goes: Go[] = Array.from({ length: 60 }, (_, i) => ({ to: "where", where: room(`r${i}`) }))
    expect(run(startNav("a"), ...goes).back).toHaveLength(50)
  })

  test("only another navigation clears the spot ⌘[ brought back", () => {
    const back = run(startNav("a"), { to: "where", where: room("design") }, { to: "history", step: "back" })
    expect(back.restore).not.toBeUndefined()
    expect(navigate(back, { to: "panel", panel: null }).restore).toBeUndefined()
  })
})

describe("a channel opens where you left it (T978)", () => {
  test("its room and tab come back", () => {
    keepPlace("d", { where: room("design"), tab: "specs" })
    expect(at(navigate(startNav(null), { to: "channel", code: "d" }))).toEqual({ channel: "d", where: room("design"), tab: "specs" })
  })

  test("a channel with nothing kept opens #general on chat", () => {
    expect(at(navigate(startNav(null), { to: "channel", code: "never" }))).toEqual({ channel: "never", where: general, tab: "chat" })
  })

  test("the open channel asked again goes to its chat, as before", () => {
    const nav = run(startNav("a"), { to: "where", where: room("design") }, { to: "tab", tab: "specs" }, { to: "channel", code: "a" })
    expect(at(nav)).toEqual({ channel: "a", where: room("design"), tab: "chat" })
  })
})

describe("stored places are read strictly (T978)", () => {
  test("every kind of place reads back, and anything else is dropped", () => {
    expect(whereOf({ kind: "room", room: "design" })).toEqual(room("design"))
    expect(whereOf({ kind: "dm", with: "maya" })).toEqual({ kind: "dm", with: "maya" })
    expect(whereOf({ kind: "task", task: 12 })).toEqual({ kind: "task", task: 12 })
    expect(whereOf({ kind: "theirs", between: ["atlas", "win"] })).toEqual({ kind: "theirs", between: ["atlas", "win"] })
    expect(whereOf({ kind: "room", room: "" })).toBeNull()
    expect(whereOf({ kind: "task", task: 1.5 })).toBeNull()
    expect(whereOf({ kind: "theirs", between: ["atlas"] })).toBeNull()
    expect(whereOf("general")).toBeNull()
    expect(whereOf(null)).toBeNull()
  })
})

describe("⌘[ and ⌘] (Ctrl on Linux) are the keys (T978)", () => {
  const key = (k: Partial<KeyboardEvent>) => historyStep({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: "", code: "", ...k })
  test("with ⌘ or Ctrl, the brackets step back and forward", () => {
    expect(key({ metaKey: true, key: "[", code: "BracketLeft" })).toBe("back")
    expect(key({ ctrlKey: true, key: "]", code: "BracketRight" })).toBe("forward")
    expect(key({ metaKey: true, key: "ü", code: "BracketLeft" })).toBe("back")
  })
  test("bare brackets, Shift or Alt with them, and other keys do nothing", () => {
    expect(key({ key: "[", code: "BracketLeft" })).toBeNull()
    expect(key({ metaKey: true, shiftKey: true, key: "{", code: "BracketLeft" })).toBeNull()
    expect(key({ metaKey: true, altKey: true, key: "[", code: "BracketLeft" })).toBeNull()
    expect(key({ metaKey: true, key: "k", code: "KeyK" })).toBeNull()
  })
})
