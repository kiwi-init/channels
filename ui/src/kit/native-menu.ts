const EDITABLE = "input, textarea, [contenteditable]:not([contenteditable='false'])"

type Closest = { closest: (selector: string) => unknown }

const hasClosest = (target: unknown): target is Closest => typeof (target as Partial<Closest> | null)?.closest === "function"

export function nativeMenuAllowed(target: unknown, selected: string): boolean {
  if (selected.trim()) return true
  return hasClosest(target) && !!target.closest(EDITABLE)
}

export function quietNativeMenu(doc: Document = document): void {
  doc.addEventListener("contextmenu", (e) => {
    if (!e.defaultPrevented && !nativeMenuAllowed(e.target, doc.getSelection()?.toString() ?? "")) e.preventDefault()
  })
}
