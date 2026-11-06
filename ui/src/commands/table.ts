import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react"

import { bridge, type KeyBindingsView } from "@kiwi/secrets/secrets.ts"
import { eventCombos, keyLabel } from "~/commands/keys"
import type { AppCommand } from "~/commands/list"

export interface Binding {
  id: AppCommand
  run: () => void
  when?: () => boolean
  palette?: false
}

export interface ModCommand {
  id: string
  title: string
  keys?: readonly string[]
  run: () => void
  from: string
}

export interface Table {
  keys: ReadonlyMap<string, readonly string[]>
  problems: readonly { id: string; why: string }[]
  file: string | null
  mods: readonly ModCommand[]
  bound: readonly Binding[]
}

export const DEFAULT_KEYS: Readonly<Partial<Record<AppCommand, string>>> = {
  "app.palette": "mod+k",
  "app.calm": "mod+t",
  "view.sidebar": "mod+\\",
  "chat.search": "mod+f",
  "nav.back": "mod+[",
  "nav.forward": "mod+]",
  "nav.next-news": "alt+arrowdown",
  "nav.previous-news": "alt+arrowup",
}

let now: Table = { keys: new Map(Object.entries(DEFAULT_KEYS).map(([id, k]) => [id, [k]])), problems: [], file: null, mods: [], bound: [] }
let owners = new Map<string, string>()
const listeners = new Set<() => void>()

function publish(next: Partial<Table>): void {
  now = { ...now, ...next }
  owners = new Map([...now.keys].flatMap(([id, list]) => list.map((k) => [k, id] as const)))
  for (const l of listeners) l()
}

publish({})

export const install = (next: Pick<Table, "keys" | "problems" | "file" | "mods">): void => publish(next)

export function bindCommands(list: readonly Binding[]): () => void {
  publish({ bound: [...now.bound, ...list] })
  return () => publish({ bound: now.bound.filter((b) => !list.includes(b)) })
}

const runnable = (id: string | undefined): { run: () => void; when?: () => boolean } | undefined =>
  id === undefined ? undefined : (now.mods.find((c) => c.id === id) ?? now.bound.findLast((b) => b.id === id))

export function runCommand(id: string): void {
  const c = runnable(id)
  if (c && (!c.when || c.when())) c.run()
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

export const commandTable = (): Table => now

export const useCommandTable = (): Table => useSyncExternalStore(subscribe, commandTable)

export const shownKeys = (table: Table, id: string): string | null => {
  const first = table.keys.get(id)?.[0]
  return first ? keyLabel(first) : null
}

export const useShownKeys = (id: AppCommand): string | null => shownKeys(useCommandTable(), id)

export function useCommands(list: readonly Binding[]): void {
  const latest = useRef(list)
  useLayoutEffect(() => {
    latest.current = list
  })
  const shape = list.map((b) => b.id + b.palette + !!b.when).join()
  useEffect(
    () =>
      bindCommands(
        latest.current.map((b, i) => ({
          ...b,
          run: () => latest.current[i]?.run(),
          ...(b.when ? { when: () => latest.current[i]?.when?.() ?? false } : {}),
        }))
      ),
    [shape]
  )
}

export function onKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing) return
  if (!(e.metaKey || e.ctrlKey || e.altKey) && (e.target as Partial<HTMLElement> | null)?.closest?.("input, textarea, select, [contenteditable='true']")) return
  for (const combo of eventCombos(e)) {
    const c = runnable(owners.get(combo))
    if (!c) continue
    if (c.when && !c.when()) return
    e.preventDefault()
    e.stopPropagation()
    c.run()
    return
  }
}

let seen = false

function takeFile(view: KeyBindingsView): void {
  if (!view.present && !seen) return
  seen = true
  void import("~/commands/rebind").then((m) => m.takeKeysFile(view))
}

export function useKeys(): void {
  useEffect(() => {
    const b = bridge()
    const served = !!b && typeof b.keyBindings === "function"
    const off = served ? b.onKeyBindings(takeFile) : null
    if (served) void b.keyBindings().then(takeFile, () => {})
    document.addEventListener("keydown", onKey, true)
    return () => {
      off?.()
      document.removeEventListener("keydown", onKey, true)
    }
  }, [])
}
