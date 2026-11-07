import { APP_PREFIXES } from "@kiwi/core/mod-names.ts"
import type { KeyBindingsView } from "@kiwi/secrets/secrets.ts"

import { keyLabel } from "~/commands/keys"
import { APP } from "~/commands/list"
import { DEFAULT_KEYS, install, type ModCommand, type Table } from "~/commands/table"

const MODS = ["mod", "ctrl", "meta", "alt", "shift"]

const ALIAS: Record<string, string> = {
  cmd: "meta",
  command: "meta",
  super: "meta",
  control: "ctrl",
  option: "alt",
  opt: "alt",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  esc: "escape",
  return: "enter",
  del: "delete",
  plus: "+",
}

const NAMED = new Set(["arrowup", "arrowdown", "arrowleft", "arrowright", "escape", "enter", "tab", "space", "backspace", "delete", "home", "end", "pageup", "pagedown"])

export function parseKey(spec: string): string | null {
  const parts = spec
    .trim()
    .toLowerCase()
    .split(/\+(?!$)/)
  const last = parts.pop() ?? ""
  const key = ALIAS[last] ?? (last === " " ? "space" : last)
  if (!NAMED.has(key) && !/^f([1-9]|1[0-9]|2[0-4])$/.test(key) && [...key].length !== 1) return null
  const mods = new Set<string>()
  for (const raw of parts) {
    const m = ALIAS[raw] ?? raw
    if (!MODS.includes(m) || mods.has(m)) return null
    mods.add(m)
  }
  if (mods.has("mod") && (mods.has("ctrl") || mods.has("meta"))) return null
  return [...MODS.filter((m) => mods.has(m)), key].join("+")
}

type Problem = Table["problems"][number]

let mods: ModCommand[] = []
let read: KeyBindingsView | null = null

const RENAMED: Readonly<Record<string, string>> = { "app.calm": "app.afk" }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

function fromFile(raw: unknown, ids: ReadonlySet<string>, problems: Problem[]): Map<string, string[]> {
  const picked = new Map<string, string[]>()
  if (raw === null) return picked
  if (!isRecord(raw)) {
    problems.push({ id: "keys.json", why: "isn't a JSON object of command ids and keys" })
    return picked
  }
  for (const [given, v] of Object.entries(raw)) {
    const id = RENAMED[given] ?? given
    const list = v === null || v === "" ? [] : typeof v === "string" ? [v] : Array.isArray(v) && v.every((s) => typeof s === "string") ? (v as string[]) : null
    if (!list) problems.push({ id, why: 'needs a key like "mod+shift+k", a list of keys, or null' })
    else if (!ids.has(id)) problems.push({ id, why: "isn't a command" })
    else {
      const keys: string[] = []
      for (const k of list) {
        const combo = parseKey(k)
        if (combo) keys.push(combo)
        else problems.push({ id, why: `"${k}" isn't a key like "mod+shift+k"` })
      }
      if (keys.length || !list.length) picked.set(id, keys)
    }
  }
  return picked
}

function rebuild(): void {
  const all: readonly { id: string; keys: readonly string[]; from?: string }[] = [
    ...APP.map((c) => ({ id: c.id, keys: [DEFAULT_KEYS[c.id] ?? []].flat() })),
    ...mods.map((c) => ({ id: c.id, keys: c.keys ?? [], from: c.from })),
  ]
  const problems: Problem[] = read?.error ? [{ id: "keys.json", why: read.error }] : []
  const picked = fromFile(read?.present ? read.keys : null, new Set(all.map((c) => c.id)), problems)
  const byKey = new Map<string, string>()
  const keys = new Map<string, string[]>()
  const take = (id: string, combo: string) => {
    byKey.set(combo, id)
    keys.set(id, [...(keys.get(id) ?? []), combo])
  }
  for (const [id, list] of picked)
    for (const combo of list) {
      const owner = byKey.get(combo)
      if (owner) problems.push({ id, why: `${keyLabel(combo)} is already ${owner}'s in keys.json` })
      else take(id, combo)
    }
  for (const c of all) {
    if (picked.has(c.id)) continue
    for (const k of c.keys) {
      const combo = parseKey(k)
      const owner = combo && byKey.get(combo)
      if (combo && !owner) take(c.id, combo)
      else if (c.from) problems.push({ id: c.id, why: combo ? `${keyLabel(combo)} is taken by ${owner}; keys.json can give it this key` : `"${k}" isn't a key` })
    }
  }
  install({ keys, problems, file: read?.present ? read.file : null, mods })
}

export function takeKeysFile(view: KeyBindingsView): void {
  read = view
  rebuild()
}

export function addCommands(list: readonly ModCommand[]): () => void {
  const taken = new Set<string>([...APP.map((c) => c.id), ...mods.map((c) => c.id)])
  const added = list.filter((c) => !APP_PREFIXES.some((p) => c.id.startsWith(`${p}.`)) && !taken.has(c.id) && (taken.add(c.id), true))
  mods = [...mods, ...added]
  rebuild()
  return () => {
    mods = mods.filter((c) => !added.includes(c))
    rebuild()
  }
}
