import type { ChannelTile, Folder } from "~/model"

export type RailItem = { kind: "channel"; tile: ChannelTile } | { kind: "folder"; folder: Folder; tiles: ChannelTile[] }

export type DropTarget = { kind: "channel"; code: string } | { kind: "folder"; id: string } | { kind: "rail" }

export function railItems(channels: readonly ChannelTile[], folders: readonly Folder[]): RailItem[] {
  const byCode = new Map(channels.map((c) => [c.code, c]))
  const folderOf = new Map<string, Folder>()
  for (const f of folders) for (const c of f.codes) if (byCode.has(c)) folderOf.set(c, f)
  const placed = new Set<string>()
  const items: RailItem[] = []
  for (const tile of channels) {
    const f = folderOf.get(tile.code)
    if (!f) {
      items.push({ kind: "channel", tile })
      continue
    }
    if (placed.has(f.id)) continue
    placed.add(f.id)
    items.push({ kind: "folder", folder: f, tiles: f.codes.flatMap((c) => byCode.get(c) ?? []) })
  }
  return items
}

const MAX_NAME = 40

export function cleanFolders(raw: unknown): Folder[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Folder[] = []
  for (const x of raw as unknown[]) {
    if (typeof x !== "object" || x === null) continue
    const f = x as Record<string, unknown>
    if (typeof f["id"] !== "string" || !Array.isArray(f["codes"])) continue
    const codes: string[] = []
    for (const c of f["codes"] as unknown[]) {
      if (typeof c !== "string" || seen.has(c)) continue
      seen.add(c)
      codes.push(c)
    }
    if (!codes.length) continue
    const name = typeof f["name"] === "string" && f["name"].trim() ? f["name"].trim().slice(0, MAX_NAME) : "Folder"
    out.push({ id: f["id"], name, codes, open: f["open"] === true })
  }
  return out
}
