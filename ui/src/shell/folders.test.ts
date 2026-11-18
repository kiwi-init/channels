import { describe, expect, test } from "bun:test"
import { dropOn, dropResult, folderNews, renamed, ungrouped } from "~/shell/folders"
import { cleanCodes, cleanFolders, inOrder, keepOrder, railItems } from "~/shell/rail-items"
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
    expect(ungrouped(start, "f")).toEqual([])
  })

  test("a folder adds up what needs you, and shows new messages only outside the open channel", () => {
    const tiles = [tile("a", { needsYou: 2, unread: 1 }), tile("b", { needsYou: 1 })]
    expect(folderNews(tiles, "a")).toEqual({ needsYou: 3, unread: false, holdsOn: true })
    expect(folderNews(tiles, null)).toEqual({ needsYou: 3, unread: true, holdsOn: false })
  })
})

describe("the rail keeps its order", () => {
  test("a channel that sorts first by activity stays where it was", () => {
    expect(keepOrder(["a", "b", "c"], ["c", "a", "b"])).toEqual(["a", "b", "c"])
  })

  test("a new channel goes to the end and a removed one drops out", () => {
    expect(keepOrder(["a", "b", "c"], ["d", "c", "a"])).toEqual(["a", "c", "d"])
  })

  test("with nothing kept yet, the incoming order stands", () => {
    expect(
      keepOrder(
        [],
        channels.map((c) => c.code)
      )
    ).toEqual(["a", "b", "c", "d"])
  })
})

describe("dragging tabs into order", () => {
  const order = ["a", "b", "c", "d"]
  const shown = (o: readonly string[], f: readonly Folder[]) => railItems(inOrder(channels, o), f).map((i) => (i.kind === "channel" ? i.tile.code : `[${i.tiles.map((t) => t.code).join(",")}]`))

  test("a channel dropped in a slot moves there and nothing else changes", () => {
    expect(dropResult({ order, folders: [] }, { kind: "channel", code: "d" }, { kind: "slot", before: { kind: "channel", code: "b" } }, newId)).toEqual({ order: ["a", "d", "b", "c"], folders: [] })
    expect(dropResult({ order, folders: [] }, { kind: "channel", code: "a" }, { kind: "slot", before: { kind: "end" } }, newId)?.order).toEqual(["b", "c", "d", "a"])
  })

  test("dropping back where it started, or on itself, saves nothing", () => {
    expect(dropResult({ order, folders: [] }, { kind: "channel", code: "b" }, { kind: "slot", before: { kind: "channel", code: "c" } }, newId)).toBeNull()
    expect(dropResult({ order, folders: [] }, { kind: "channel", code: "b" }, { kind: "slot", before: { kind: "channel", code: "b" } }, newId)).toBeNull()
    expect(dropResult({ order, folders: [] }, { kind: "channel", code: "b" }, { kind: "join", target: { kind: "channel", code: "b" } }, newId)).toBeNull()
  })

  test("joining a tab makes a folder where the target sits, even when the dragged one was before it", () => {
    const next = dropResult({ order, folders: [] }, { kind: "channel", code: "a" }, { kind: "join", target: { kind: "channel", code: "c" } }, () => "f")
    expect(next && shown(next.order, next.folders)).toEqual(["b", "[c,a]", "d"])
  })

  test("a slot outside a folder takes the channel out of it, saved in one result", () => {
    const folders: Folder[] = [{ id: "f", name: "work", codes: ["b", "c"], open: true }]
    const next = dropResult({ order, folders }, { kind: "channel", code: "c" }, { kind: "slot", before: { kind: "end" } }, newId)
    expect(next).toEqual({ order: ["a", "b", "d", "c"], folders: [{ id: "f", name: "work", codes: ["b"], open: true }] })
  })

  test.each([true, false])("a folder moves as one unit, in its own order (open: %p)", (open) => {
    const folders: Folder[] = [{ id: "f", name: "work", codes: ["c", "b"], open }]
    const next = dropResult({ order, folders }, { kind: "folder", id: "f" }, { kind: "slot", before: { kind: "channel", code: "a" } }, newId)
    expect(next?.order).toEqual(["c", "b", "a", "d"])
    expect(next && shown(next.order, next.folders)).toEqual(["[c,b]", "a", "d"])
  })

  test("a folder dropped on itself, on one of its own channels or onto a tab doesn't nest or move", () => {
    const folders: Folder[] = [{ id: "f", name: "work", codes: ["b", "c"], open: true }]
    expect(dropResult({ order, folders }, { kind: "folder", id: "f" }, { kind: "slot", before: { kind: "folder", id: "f" } }, newId)).toBeNull()
    expect(dropResult({ order, folders }, { kind: "folder", id: "f" }, { kind: "slot", before: { kind: "channel", code: "c" } }, newId)).toBeNull()
    expect(dropResult({ order, folders }, { kind: "folder", id: "f" }, { kind: "join", target: { kind: "channel", code: "d" } }, newId)).toBeNull()
  })

  test("a saved order keeps its places, a new channel goes to the end and a removed one drops out", () => {
    expect(keepOrder(["d", "a", "c"], ["a", "b", "c"])).toEqual(["a", "c", "b"])
    expect(cleanCodes(["a", "a", 3, "", "b"])).toEqual(["a", "b"])
    expect(cleanCodes("nope")).toEqual([])
  })
})
