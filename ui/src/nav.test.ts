import { describe, expect, test } from "bun:test"
import type { Where } from "~/model"
import { historyCan, historyStep, navigate, startNav, type Go, type Nav } from "~/nav"
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
    const nav = run(startNav("a"), { to: "where", where: general }, { to: "modal", modal: { kind: "channel" } }, { to: "where", where: general })
    expect(nav.back).toEqual([])
  })

  test("a message link into another channel is one step: ⌘[ goes straight back, not through that channel's last room", () => {
    keepPlace("b", { where: room("ops") })
    const nav = run(startNav("a"), { to: "channel", code: "b", jump: true }, { to: "where", where: room("alerts"), replace: true })
    expect(at(nav)).toEqual({ channel: "b", where: room("alerts"), tab: "chat" })
    expect(nav.back.map((p) => [p.channel, p.where])).toEqual([["a", general]])
  })

  test("a message link into another room of the same channel is one step too", () => {
    const nav = run(startNav("a"), { to: "channel", code: "a", jump: true }, { to: "where", where: room("alerts"), replace: true })
    expect(nav.back.map((p) => [p.channel, p.where])).toEqual([["a", general]])
  })

  test("going somewhere new drops the places ahead", () => {
    const back = run(startNav("a"), { to: "where", where: room("design") }, { to: "history", step: "back" })
    expect(back.ahead).toHaveLength(1)
    expect(navigate(back, { to: "tab", tab: "specs" }).ahead).toEqual([])
  })

  test("tabs are places, and nothing happens at either end", () => {
    const nav = run(startNav("a"), { to: "tab", tab: "agents" })
    expect(nav.back.map((p) => p.at === "channel" && p.tab)).toEqual(["chat"])
    const start = startNav("a")
    expect(navigate(start, { to: "history", step: "back" })).toBe(start)
    expect(navigate(start, { to: "history", step: "forward" })).toBe(start)
  })

  test("going back to another channel closes that channel's panel", () => {
    const nav = run(startNav("a"), { to: "channel", code: "c" }, { to: "panel", panel: { kind: "task", task: 7 } }, { to: "history", step: "back" })
    expect(nav.channel).toBe("a")
    expect(nav.panel).toBeNull()
  })

  test("back and forward close an open modal and stay where you are", () => {
    const open = run(startNav("a"), { to: "where", where: room("design") }, { to: "modal", modal: { kind: "person", name: "maya" } })
    for (const step of ["back", "forward"] as const) {
      const closed = navigate(open, { to: "history", step })
      expect(closed.modal).toBeNull()
      expect(at(closed)).toEqual(at(open))
      expect(closed.back).toEqual(open.back)
    }
  })

  test("a modal closes when you go somewhere or open a work panel, and stays when the panel closes", () => {
    const open = navigate(startNav("a"), { to: "modal", modal: { kind: "channel" } })
    expect(navigate(open, { to: "panel", panel: { kind: "task", task: 7 } }).modal).toBeNull()
    expect(navigate(open, { to: "panel", panel: null }).modal).toEqual({ kind: "channel" })
    expect(navigate(open, { to: "where", where: room("design") }).modal).toBeNull()
    expect(navigate(open, { to: "channel", code: "b" }).modal).toBeNull()
    expect(navigate(open, { to: "settings" }).modal).toBeNull()
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

describe("every place you can go to is a step back (T1848)", () => {
  const back: Go = { to: "history", step: "back" }
  const forward: Go = { to: "history", step: "forward" }

  test("Home is a place: back from a channel returns to it, and forward returns to the channel", () => {
    const inChannel = run(startNav(null), { to: "channel", code: "a" })
    const home = navigate(inChannel, back)
    expect(home.page).toBe("channel")
    expect(home.channel).toBeNull()
    expect(navigate(home, forward).channel).toBe("a")
    const viaHome = run(startNav("a"), { to: "home" }, { to: "channel", code: "b" }, back)
    expect(viaHome.channel).toBeNull()
    expect(navigate(viaHome, back).channel).toBe("a")
  })

  test("Settings is a place, section by section, and closing it leaves it one step back", () => {
    const nav = run(startNav("a"), { to: "settings", section: "appearance" }, { to: "settings", section: "agents" }, { to: "back" })
    expect(nav.page).toBe("channel")
    const agents = navigate(nav, back)
    expect([agents.page, agents.section]).toEqual(["settings", "agents"])
    const appearance = navigate(agents, back)
    expect([appearance.page, appearance.section]).toEqual(["settings", "appearance"])
    const channel = navigate(appearance, back)
    expect([channel.page, channel.channel]).toEqual(["channel", "a"])
    expect(navigate(channel, forward).section).toBe("appearance")
  })

  test("opening Settings on the section it already shows adds nothing", () => {
    const nav = run(startNav("a"), { to: "settings" }, { to: "settings" })
    expect(nav.back).toHaveLength(1)
  })

  test("an open spec is a place: back from elsewhere returns to that spec, not the list", () => {
    const nav = run(startNav("a"), { to: "spec", ask: null }, { to: "spec", ask: 12, part: "inside" }, { to: "where", where: room("design") })
    const spec = navigate(nav, back)
    expect([spec.tab, spec.spec, spec.part]).toEqual(["specs", 12, "inside"])
    const list = navigate(spec, back)
    expect([list.tab, list.spec]).toEqual(["specs", undefined])
    expect(navigate(list, forward).spec).toBe(12)
  })

  test("another part of the same spec is the same place", () => {
    const nav = run(startNav("a"), { to: "spec", ask: 12 }, { to: "spec", ask: 12, part: "result" })
    expect(nav.back).toHaveLength(1)
  })

  test("a panel, a modal and a dialog are not places", () => {
    const nav = run(startNav("a"), { to: "panel", panel: { kind: "task", task: 7 } }, { to: "modal", modal: { kind: "invite" } }, { to: "modal", modal: null }, { to: "dialog", dialog: "palette" })
    expect(nav.back).toEqual([])
  })
})

describe("every task link does what a board row does (T1849)", () => {
  test("a task link opens the task's panel, and the same link again closes it", () => {
    const open = navigate(startNav("a"), { to: "task", task: 7 })
    expect(open.panel).toEqual({ kind: "task", task: 7 })
    expect(navigate(open, { to: "task", task: 7 }).panel).toBeNull()
  })

  test("a link to another task swaps the panel instead of closing it", () => {
    const nav = run(startNav("a"), { to: "task", task: 7 }, { to: "task", task: 8 })
    expect(nav.panel).toEqual({ kind: "task", task: 8 })
  })

  test("opening closes a modal, as any work panel does; closing leaves the place alone", () => {
    const nav = run(startNav("a"), { to: "modal", modal: { kind: "invite" } }, { to: "task", task: 7 })
    expect(nav.modal).toBeNull()
    const closed = navigate(nav, { to: "task", task: 7 })
    expect([closed.channel, closed.tab, closed.back.length]).toEqual(["a", "chat", 0])
  })

  test("a command that opens a task (the palette, search) still only opens it", () => {
    const nav = run(startNav("a"), { to: "panel", panel: { kind: "task", task: 7 } }, { to: "panel", panel: { kind: "task", task: 7 } })
    expect(nav.panel).toEqual({ kind: "task", task: 7 })
  })
})

describe("a channel opens in the room you left, on its chat (T978, T1833)", () => {
  test("its room comes back", () => {
    keepPlace("d", { where: room("design") })
    expect(at(navigate(startNav(null), { to: "channel", code: "d" }))).toEqual({ channel: "d", where: room("design"), tab: "chat" })
  })

  test("the tab you left it on does not: a channel left on Specs opens on chat", () => {
    const away = run(startNav("d"), { to: "where", where: room("design") }, { to: "tab", tab: "specs" })
    keepPlace("d", { where: away.where })
    expect(at(navigate(navigate(away, { to: "channel", code: "e" }), { to: "channel", code: "d" }))).toEqual({ channel: "d", where: room("design"), tab: "chat" })
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

describe("the top bar's Back and Forward arrows are on exactly when their history step would move (#2372)", () => {
  const moves = (nav: Nav, step: "back" | "forward") => navigate(nav, { to: "history", step }) !== nav

  test("with nothing behind or ahead both are off, and each step would leave the nav as it is", () => {
    const start = startNav("a")
    expect(historyCan(start)).toEqual({ back: false, forward: false })
    expect(moves(start, "back")).toBe(false)
    expect(moves(start, "forward")).toBe(false)
  })

  test("after a step somewhere Back is on, and after Back, Forward is on too", () => {
    const there = run(startNav("a"), { to: "where", where: room("design") })
    expect(historyCan(there)).toEqual({ back: true, forward: false })
    expect(moves(there, "back")).toBe(true)
    const back = navigate(there, { to: "history", step: "back" })
    expect(historyCan(back)).toEqual({ back: false, forward: true })
    expect(moves(back, "forward")).toBe(true)
  })

  test("going somewhere new after Back turns Forward off again", () => {
    const back = run(startNav("a"), { to: "where", where: room("design") }, { to: "history", step: "back" })
    expect(historyCan(navigate(back, { to: "tab", tab: "specs" })).forward).toBe(false)
  })

  test("with a modal open both are on even with empty stacks, because each step first closes the modal", () => {
    const open = navigate(startNav("a"), { to: "modal", modal: { kind: "person", name: "maya" } })
    expect(open.back).toEqual([])
    expect(open.ahead).toEqual([])
    expect(historyCan(open)).toEqual({ back: true, forward: true })
    expect(moves(open, "back")).toBe(true)
    expect(moves(open, "forward")).toBe(true)
    expect(navigate(open, { to: "history", step: "back" }).modal).toBeNull()
    expect(navigate(open, { to: "history", step: "forward" }).modal).toBeNull()
  })
})
