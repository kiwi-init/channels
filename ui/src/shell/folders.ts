import type { ChannelTile, Folder } from "~/model"
import type { DropTarget } from "~/shell/rail-items"

export const FOLDER_NAME = "Folder"

export const newFolderId = (): string => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const MAX_NAME = 40

const without = (folders: readonly Folder[], code: string): Folder[] => folders.map((f) => ({ ...f, codes: f.codes.filter((c) => c !== code) })).filter((f) => f.codes.length > 0)

export function dropOn(folders: readonly Folder[], code: string, target: DropTarget, newId: () => string): Folder[] {
  if (target.kind === "channel" && target.code === code) return [...folders]
  const rest = without(folders, code)
  if (target.kind === "rail") return rest
  if (target.kind === "folder") {
    if (!rest.some((f) => f.id === target.id)) return [...folders]
    return rest.map((f) => (f.id === target.id ? { ...f, codes: [...f.codes, code] } : f))
  }
  const holder = rest.find((f) => f.codes.includes(target.code))
  if (holder) return rest.map((f) => (f === holder ? { ...f, codes: f.codes.flatMap((c) => (c === target.code ? [c, code] : [c])) } : f))
  return [...rest, { id: newId(), name: FOLDER_NAME, codes: [target.code, code], open: false }]
}

export const renamed = (folders: readonly Folder[], id: string, name: string): Folder[] => folders.map((f) => (f.id === id ? { ...f, name: name.trim().slice(0, MAX_NAME) || FOLDER_NAME } : f))

export const toggled = (folders: readonly Folder[], id: string): Folder[] => folders.map((f) => (f.id === id ? { ...f, open: !f.open } : f))

export const ungrouped = (folders: readonly Folder[], id: string): Folder[] => folders.filter((f) => f.id !== id)

export function folderNews(tiles: readonly ChannelTile[], on: string | null): { needsYou: number; unread: boolean; holdsOn: boolean } {
  return {
    needsYou: tiles.reduce((n, t) => n + t.needsYou, 0),
    unread: tiles.some((t) => t.unread > 0 && t.code !== on),
    holdsOn: on !== null && tiles.some((t) => t.code === on),
  }
}
