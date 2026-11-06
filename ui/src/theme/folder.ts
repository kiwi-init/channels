import { useSyncExternalStore } from "react"

import { bridge, type FolderThemesView } from "@kiwi/secrets/secrets.ts"
import type { CustomTheme } from "~/model"
import { cleanThemes, FROM_FOLDER } from "~/theme/themes"

const KEY = "ui.themes.folder"

export interface Folder {
  themes: CustomTheme[]
  dir: string | null
  skipped: FolderThemesView["skipped"]
}

const served = (): boolean => typeof bridge()?.folderThemes === "function"

function cached(): CustomTheme[] {
  if (!served()) return []
  try {
    return cleanThemes(JSON.parse(localStorage.getItem(KEY) ?? "[]"))
  } catch {
    // A cache that can't be read only costs the first paint: the folder answers right after.
    return []
  }
}

let now: Folder = { themes: cached(), dir: null, skipped: [] }
const listeners = new Set<() => void>()

export const fileOf = (id: string): string | null => (id.startsWith(FROM_FOLDER) ? id.slice(FROM_FOLDER.length) : null)

export function showFolder(view: FolderThemesView): void {
  const themes = cleanThemes(view.themes.map((t) => ({ id: `${FROM_FOLDER}${t.file}`, name: t.name, appearance: t.appearance, base: t.base })))
  now = { themes, dir: view.dir, skipped: view.skipped }
  for (const l of listeners) l()
}

export function takeFolder(view: FolderThemesView): void {
  showFolder(view)
  try {
    if (now.themes.length) localStorage.setItem(KEY, JSON.stringify(now.themes))
    else localStorage.removeItem(KEY)
  } catch {
    // Without storage the next start paints the default first, then the folder's theme.
  }
}

export const folderThemes = (): CustomTheme[] => now.themes

export const useFolder = (): Folder =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => now
  )

let started = false

export function startFolder(): void {
  const b = bridge()
  if (started || !b || !served()) return
  started = true
  b.onFolderThemes(takeFolder)
  void b.folderThemes().then(takeFolder, () => {})
}
