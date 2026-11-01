import { describe, expect, test } from "bun:test"
import { dropOn, folderNews, renamed, toggled, ungrouped } from "~/shell/folders"
import { cleanFolders, railItems } from "~/shell/rail-items"
import type { ChannelTile, Folder } from "~/model"

const tile = (code: string, extra: Partial<ChannelTile> = {}): ChannelTile => ({ code, title: code, state: "member", unread: 0, needsYou: 0, last: 0, ...extra })
const channels = ["a", "b", "c", "d"].map((c) => tile(c))
let n = 0
const newId = () => `f${++n}`

describe("rail folders", () => {
  test("dropping a channel on another makes a folder where the target sits", () => {
    const folders = dropOn([], "c", { kind: "channel", code: "a" }, () => "f")
    expect(folders).toEqual([{ id: "f", name: "Folder", codes: ["a", "c"], open: false }])
    const items = railItems(channels, folders)
    expect(items.map((i) => (i.kind === "channel" ? i.tile.code : `[${i.tiles.map((t) => t.code).join(",")}]`))).toEqual(["[a,c]", "b", "d"])
  })

  test("dropping on a folder, or on a channel inside one, adds to it", () => {
    const start: Folder[] = [{ id: "f", name: "work", codes: ["a", "b"], open: true }]
    expect(dropOn(start, "d", { kind: "folder", id: "f" }, newId)[0]?.codes).toEqual(["a", "b", "d"])
    expect(dropOn(start, "d", { kind: "channel", code: "a" }, newId)[0]?.codes).toEqual(["a", "d", "b"])
  })

  test("dropping on the rail takes a channel out, and a folder left empty goes away", () => {
    const start: Folder[] = [{ id: "f", name: "work", codes: ["a"], open: false }]
    expect(dropOn(start, "a", { kind: "rail" }, newId)).toEqual([])
    const two: Folder[] = [{ id: "f", name: "work", codes: ["a", "b"], open: false }]
    expect(dropOn(two, "a", { kind: "rail" }, newId)).toEqual([{ id: "f", name: "work", codes: ["b"], open: false }])
  })

  test("moving a channel between folders leaves it in only one", () => {
    const start: Folder[] = [
      { id: "f", name: "x", codes: ["a", "b"], open: false },
      { id: "g", name: "y", codes: ["c", "d"], open: false },
    ]
    const moved = dropOn(start, "b", { kind: "folder", id: "g" }, newId)
    expect(moved.map((f) => f.codes)).toEqual([["a"], ["c", "d", "b"]])
  })

  test("dropping a channel on itself changes nothing", () => {
    const start: Folder[] = [{ id: "f", name: "x", codes: ["a", "b"], open: false }]
    expect(dropOn(start, "a", { kind: "channel", code: "a" }, newId)).toEqual(start)
  })

  test("a folder's channels that are gone don't show, and a folder with none left doesn't either", () => {
    const folders: Folder[] = [
      { id: "f", name: "x", codes: ["zz", "b"], open: false },
      { id: "g", name: "y", codes: ["yy"], open: false },
    ]
    const items = railItems(channels, folders)
    expect(items.filter((i) => i.kind === "folder").map((i) => (i.kind === "folder" ? i.tiles.map((t) => t.code) : []))).toEqual([["b"]])
    expect(items).toHaveLength(4)
  })

  test("stored folders are read back clean: bad entries drop, a channel sits in one folder, names are trimmed", () => {
    const raw = [{ id: "f", name: "  games ", codes: ["a", "a", 3], open: true }, { id: "g", codes: ["a", "b"] }, { name: "no id", codes: ["c"] }, "junk", { id: "h", name: "", codes: [] }]
    expect(cleanFolders(raw)).toEqual([
      { id: "f", name: "games", codes: ["a"], open: true },
      { id: "g", name: "Folder", codes: ["b"], open: false },
    ])
    expect(cleanFolders("nope")).toEqual([])
  })

  test("rename, open and ungroup", () => {
    const start: Folder[] = [{ id: "f", name: "x", codes: ["a", "b"], open: false }]
    expect(renamed(start, "f", "  games  ")[0]?.name).toBe("games")
    expect(renamed(start, "f", "   ")[0]?.name).toBe("Folder")
    expect(toggled(start, "f")[0]?.open).toBe(true)
    expect(ungrouped(start, "f")).toEqual([])
  })

  test("a folder adds up what needs you, and shows new messages only outside the open channel", () => {
    const tiles = [tile("a", { needsYou: 2, unread: 1 }), tile("b", { needsYou: 1 })]
    expect(folderNews(tiles, "a")).toEqual({ needsYou: 3, unread: false, holdsOn: true })
    expect(folderNews(tiles, null)).toEqual({ needsYou: 3, unread: true, holdsOn: false })
  })
})
