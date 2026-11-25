import type { ChannelTile, Folder } from "~/model"
import { MAX_NAME, type Aim, type DropTarget, type Moving, type Slot } from "~/shell/rail-items"
import { t } from "~/i18n/i18n"

export const folderName = (): string => t("shell.folders.default")

export const newFolderId = (): string => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

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
  return [...rest, { id: newId(), name: folderName(), codes: [target.code, code], open: false }]
}

export interface Placing {
  order: string[]
  folders: Folder[]
}

const placed = (order: readonly string[], block: readonly string[], at: string | null): string[] => {
  const rest = order.filter((c) => !block.includes(c))
  const i = at === null ? -1 : rest.indexOf(at)
  return i < 0 ? [...rest, ...block] : [...rest.slice(0, i), ...block, ...rest.slice(i)]
}

const after = (order: readonly string[], block: readonly string[], anchor: string): string[] => {
  const rest = order.filter((c) => !block.includes(c))
  const i = rest.indexOf(anchor)
  return i < 0 ? [...rest, ...block] : [...rest.slice(0, i + 1), ...block, ...rest.slice(i + 1)]
}

const slotCode = (slot: Slot, order: readonly string[], folders: readonly Folder[], block: readonly string[]): string | null => {
  if (slot.kind === "end") return null
  if (slot.kind === "channel") return slot.code
  const codes = folders.find((f) => f.id === slot.id)?.codes ?? []
  return order.find((c) => codes.includes(c) && !block.includes(c)) ?? null
}

const same = (a: Placing, b: Placing): boolean => a.order.join("\n") === b.order.join("\n") && JSON.stringify(a.folders) === JSON.stringify(b.folders)

export function dropResult(now: Placing, moving: Moving, aim: Aim, newId: () => string): Placing | null {
  const next = moving.kind === "channel" ? channelDrop(now, moving.code, aim, newId) : folderDrop(now, moving.id, aim)
  return next && !same(now, next) ? next : null
}

function channelDrop({ order, folders }: Placing, code: string, aim: Aim, newId: () => string): Placing | null {
  if (aim.kind === "join") {
    if (aim.target.kind === "channel" && aim.target.code === code) return null
    const target = aim.target
    const joined = dropOn(folders, code, target, newId)
    const anchor = target.kind === "channel" ? target.code : [...order].reverse().find((c) => c !== code && (joined.find((f) => f.id === target.id)?.codes ?? []).includes(c))
    return { order: anchor ? after(order, [code], anchor) : [...order], folders: joined }
  }
  if (aim.before.kind === "channel" && aim.before.code === code) return null
  const out = dropOn(folders, code, { kind: "rail" }, newId)
  return { order: placed(order, [code], slotCode(aim.before, order, out, [code])), folders: out }
}

function folderDrop({ order, folders }: Placing, id: string, aim: Aim): Placing | null {
  const folder = folders.find((f) => f.id === id)
  if (!folder || aim.kind === "join") return null
  const slot = aim.before
  if ((slot.kind === "folder" && slot.id === id) || (slot.kind === "channel" && folder.codes.includes(slot.code))) return null
  const block = folder.codes.filter((c) => order.includes(c))
  return { order: placed(order, block, slotCode(slot, order, folders, block)), folders: [...folders] }
}

export const renamed = (folders: readonly Folder[], id: string, name: string): Folder[] => folders.map((f) => (f.id === id ? { ...f, name: name.trim().slice(0, MAX_NAME) || folderName() } : f))

export const liveFolders = (folders: readonly Folder[], channels: readonly string[]): Folder[] =>
  folders.map((f) => ({ ...f, codes: f.codes.filter((c) => channels.includes(c)) })).filter((f) => f.codes.length > 0)

export const ungrouped = (folders: readonly Folder[], id: string): Folder[] => folders.filter((f) => f.id !== id)

export function folderNews(tiles: readonly ChannelTile[], on: string | null): { needsYou: number; unread: boolean; holdsOn: boolean } {
  return {
    needsYou: tiles.reduce((n, t) => n + t.needsYou, 0),
    unread: tiles.some((t) => t.unread > 0 && t.code !== on),
    holdsOn: on !== null && tiles.some((t) => t.code === on),
  }
}
