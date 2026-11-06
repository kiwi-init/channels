export interface Shortcut {
  mod: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  code: string
  key: string
}

export interface Pressed {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const NAMED: Record<string, string> = {
  enter: "Enter",
  backspace: "Backspace",
  delete: "Delete",
  tab: "Tab",
  space: "Space",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  "-": "Minus",
  "=": "Equal",
  "[": "BracketLeft",
  "]": "BracketRight",
}

const SHOWN: Record<string, string> = {
  Enter: "↵",
  Backspace: "⌫",
  Delete: "⌦",
  Tab: "⇥",
  Space: "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
}

const MODIFIERS = new Set(["mod", "cmd", "ctrl", "alt", "opt", "shift"])

export function shortcut(text: string): Shortcut | null {
  const parts = String(text)
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
  const key = parts.pop()
  if (!key || parts.some((p) => !MODIFIERS.has(p))) return null
  const code = /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : /^[0-9]$/.test(key) ? `Digit${key}` : NAMED[key]
  if (!code) return null
  const has = new Set(parts)
  const s = { mod: has.has("mod") || has.has("cmd"), ctrl: has.has("ctrl"), alt: has.has("alt") || has.has("opt"), shift: has.has("shift"), code, key }
  return s.mod || s.ctrl || s.alt ? s : null
}

export function pressed(e: Pressed, s: Shortcut, mac: boolean): boolean {
  const meta = mac && s.mod
  const ctrl = mac ? s.ctrl : s.mod || s.ctrl
  return e.code === s.code && e.metaKey === meta && e.ctrlKey === ctrl && e.altKey === s.alt && e.shiftKey === s.shift
}

export function keysLabel(s: Shortcut, mac: boolean): string {
  const k = SHOWN[s.code] ?? s.key.toUpperCase()
  if (mac) return `${s.ctrl ? "⌃" : ""}${s.alt ? "⌥" : ""}${s.shift ? "⇧" : ""}${s.mod ? "⌘" : ""}${k}`
  return [s.mod || s.ctrl ? "Ctrl" : "", s.alt ? "Alt" : "", s.shift ? "Shift" : "", k].filter(Boolean).join("+")
}

export const onMac = (): boolean => /Mac/i.test(navigator.platform)
