const CODES: Record<string, string> = { BracketLeft: "[", BracketRight: "]", Backslash: "\\", Slash: "/", Comma: ",", Period: ".", Semicolon: ";", Quote: "'", Minus: "-", Equal: "=", Backquote: "`" }

type KeyEventLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">

function eventKeys(e: KeyEventLike): string[] {
  const named = e.key === " " ? "space" : e.key.toLowerCase()
  const letter = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : null
  const symbol = CODES[e.code] ?? (/^Digit\d$/.test(e.code) ? e.code.slice(5) : null)
  const coded = /^[\x21-\x7e]$/.test(e.key) ? (e.shiftKey ? symbol : null) : (letter ?? symbol)
  return coded && coded !== named ? [named, coded] : [named]
}

export function eventCombos(e: KeyEventLike): string[] {
  const lead = e.metaKey || e.ctrlKey ? ["mod", e.metaKey ? (e.ctrlKey ? "" : "meta") : "ctrl"].filter(Boolean) : [""]
  const rest = [e.altKey && "alt", e.shiftKey && "shift"].filter(Boolean).join("+")
  return lead.flatMap((m) => eventKeys(e).map((k) => [m, rest, k].filter(Boolean).join("+")))
}

const ORDER = ["ctrl", "alt", "shift", "mod", "meta"]
const MAC: Record<string, string> = { mod: "⌘", meta: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" }
const PC: Record<string, string> = { mod: "Ctrl", meta: "Super", ctrl: "Ctrl", alt: "Alt", shift: "Shift" }
const GLYPHS: Record<string, string> = { arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→", escape: "Esc", enter: "↩", backspace: "⌫", delete: "⌦" }

export const onMac = (): boolean => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

export function keyLabel(combo: string, mac = onMac()): string {
  const parts = combo.split(/\+(?!$)/)
  const key = parts.pop() ?? ""
  const shown = GLYPHS[key] ?? key[0]!.toUpperCase() + key.slice(1)
  const mods = parts.sort((a, b) => (mac ? ORDER.indexOf(a) - ORDER.indexOf(b) : 0)).map((m) => (mac ? MAC : PC)[m])
  return mac ? mods.join("") + shown : [...mods, shown].join("+")
}
