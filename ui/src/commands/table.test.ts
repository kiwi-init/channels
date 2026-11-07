import { afterAll, afterEach, describe, expect, test } from "bun:test"

import { APP_PREFIXES } from "@kiwi/core/mod-names.ts"
import type { KeyBindingsView } from "@kiwi/secrets/secrets.ts"

const kiwi = {
  getSnapshot: () => ({ relayUrl: "", person: null, channels: [], computers: [], phones: [], pending: [], personalities: [] }),
  onStore: () => () => {},
}
Object.assign(globalThis, { window: { kiwi } })
afterAll(() => Reflect.deleteProperty(globalThis, "window"))

const { bindCommands, commandTable, onKey, runCommand } = await import("~/commands/table")
const { addCommands, takeKeysFile: setKeysFile } = await import("~/commands/rebind")

const FILE = "/home/ana/.kiwi/keys.json"
const file = (keys: unknown): KeyBindingsView => ({ file: FILE, present: true, keys })
const undo: (() => void)[] = []
afterEach(() => {
  for (const u of undo.splice(0)) u()
  setKeysFile({ file: FILE, present: false, keys: null })
})

function key(e: Partial<KeyboardEvent> & { inField?: true }) {
  const fired = { prevented: false, stopped: false }
  onKey({
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    isComposing: false,
    target: e.inField ? { closest: () => ({}) } : null,
    preventDefault: () => void (fired.prevented = true),
    stopPropagation: () => void (fired.stopped = true),
    ...e,
  } as unknown as KeyboardEvent)
  return fired
}

const ran: string[] = []
const bindAll = (when?: () => boolean) =>
  undo.push(
    bindCommands([
      { id: "app.palette", run: () => ran.push("palette") },
      { id: "app.settings", run: () => ran.push("settings") },
      { id: "nav.back", run: () => ran.push("back"), ...(when ? { when } : {}) },
    ])
  )

describe("the command table", () => {
  test("every app command is known with its keys before anything binds it, so keys.json can name any of them", () => {
    setKeysFile(file({ "chat.search": "mod+shift+f" }))
    const t = commandTable()
    expect(t.bound.some((b) => b.id === "chat.search")).toBe(false)
    expect(t.keys.get("chat.search")).toEqual(["mod+shift+f"])
    expect(t.problems).toEqual([])
    expect(t.file).toBe(FILE)
  })

  test("a bound command runs on its key and stops it there; an unbound one lets the key through", () => {
    ran.length = 0
    expect(key({ metaKey: true, key: "k", code: "KeyK" }).prevented).toBe(false)
    bindAll()
    const k = key({ metaKey: true, key: "k", code: "KeyK" })
    expect(k).toEqual({ prevented: true, stopped: true })
    expect(ran).toEqual(["palette"])
  })

  test("a command that can't run now leaves the key alone", () => {
    ran.length = 0
    bindAll(() => false)
    expect(key({ metaKey: true, key: "[", code: "BracketLeft" }).prevented).toBe(false)
    runCommand("nav.back")
    expect(ran).toEqual([])
  })

  test("a plain key typed into a field stays in the field", () => {
    ran.length = 0
    bindAll()
    setKeysFile(file({ "app.settings": "g" }))
    expect(key({ key: "g", code: "KeyG", inField: true }).prevented).toBe(false)
    expect(key({ key: "g", code: "KeyG" }).prevented).toBe(true)
    expect(ran).toEqual(["settings"])
  })
})

describe("keys.json", () => {
  test("it moves a key, adds a second one, or turns one off", () => {
    setKeysFile(file({ "app.palette": ["mod+p", "mod+shift+p"], "app.afk": null }))
    const t = commandTable()
    expect(t.keys.get("app.palette")).toEqual(["mod+p", "mod+shift+p"])
    expect(t.keys.get("app.afk")).toBeUndefined()
    bindAll()
    expect(key({ metaKey: true, key: "k", code: "KeyK" }).prevented).toBe(false)
  })

  test("a keys.json from before AFK still moves its key: app.calm is app.afk", () => {
    setKeysFile(file({ "app.calm": "mod+shift+a" }))
    const t = commandTable()
    expect(t.keys.get("app.afk")).toEqual(["mod+shift+a"])
    expect(t.problems).toEqual([])
  })

  test("a key it gives away leaves the command that had it", () => {
    setKeysFile(file({ "app.settings": "mod+k" }))
    expect(commandTable().keys.get("app.settings")).toEqual(["mod+k"])
    expect(commandTable().keys.get("app.palette")).toBeUndefined()
  })

  test("each bad entry is skipped with its reason, and the good ones still apply", () => {
    setKeysFile(file({ "app.nope": "mod+j", "app.afk": "mod+kk", "app.join": 7, "app.settings": "mod+j", "app.computers": "mod+j" }))
    const t = commandTable()
    expect(t.problems).toEqual([
      { id: "app.nope", why: "isn't a command" },
      { id: "app.afk", why: '"mod+kk" isn\'t a key like "mod+shift+k"' },
      { id: "app.join", why: 'needs a key like "mod+shift+k", a list of keys, or null' },
      { id: "app.computers", why: expect.stringContaining("is already app.settings's in keys.json") },
    ])
    expect(t.keys.get("app.settings")).toEqual(["mod+j"])
  })

  test("a file that isn't JSON, or isn't an object, keeps every default", () => {
    setKeysFile({ file: FILE, present: true, keys: null, error: "isn't valid JSON" })
    expect(commandTable().problems).toEqual([{ id: "keys.json", why: "isn't valid JSON" }])
    expect(commandTable().keys.get("app.palette")).toEqual(["mod+k"])
    setKeysFile(file(["mod+k"]))
    expect(commandTable().problems).toEqual([{ id: "keys.json", why: "isn't a JSON object of command ids and keys" }])
  })

  test("no keys.json: no file, no problems", () => {
    expect(commandTable()).toMatchObject({ file: null, problems: [] })
  })
})

describe("mods' commands", () => {
  test("a mod adds and removes commands; one that takes the app's key loses it, and keys.json can give it back", () => {
    const got: string[] = []
    const remove = addCommands([
      { id: "notes.open", title: "Open notes", keys: ["mod+k"], from: "notes", run: () => got.push("open") },
      { id: "notes.new", title: "New note", keys: ["mod+shift+n"], from: "notes", run: () => got.push("new") },
    ])
    undo.push(remove)
    let t = commandTable()
    expect(t.keys.get("notes.open")).toBeUndefined()
    expect(t.problems).toEqual([{ id: "notes.open", why: expect.stringContaining("is taken by app.palette; keys.json can give it this key") }])
    expect(t.keys.get("notes.new")).toEqual(["mod+shift+n"])
    runCommand("notes.new")
    setKeysFile(file({ "notes.open": "mod+k" }))
    t = commandTable()
    expect(t.keys.get("notes.open")).toEqual(["mod+k"])
    expect(t.mods.map((c) => c.id)).toEqual(["notes.open", "notes.new"])
    remove()
    undo.length = 0
    expect(commandTable().mods).toEqual([])
    expect(got).toEqual(["new"])
  })

  test("a mod can't take an app id, an app prefix, or another mod's id", () => {
    const run = () => {}
    undo.push(addCommands([{ id: "notes.open", title: "Open", from: "notes", run }]))
    undo.push(
      addCommands([
        { id: "app.palette", title: "Mine", from: "evil", run },
        ...APP_PREFIXES.map((p) => ({ id: `${p}.anything`, title: "Mine", from: "evil", run })),
        { id: "notes.open", title: "Mine", from: "evil", run },
        { id: "evil.ok", title: "Fine", from: "evil", run },
      ])
    )
    const t = commandTable()
    expect(t.mods.filter((c) => c.from === "evil").map((c) => c.id)).toEqual(["evil.ok"])
  })
})
