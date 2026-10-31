import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react"

import { nativeMenuAllowed } from "~/kit/native-menu"
import { store } from "~/live/value"

export interface MenuItem {
  label: string
  run: () => void
}

interface OpenMenu {
  x: number
  y: number
  label: string
  groups: readonly (readonly MenuItem[])[]
}

const GUTTER = 8

const open = store<OpenMenu | null>(null)

export function showMenu(e: MouseEvent, label: string, groups: readonly (readonly MenuItem[])[]): void {
  if (nativeMenuAllowed(e.target, document.getSelection()?.toString() ?? "")) return
  const filled = groups.filter((g) => g.length > 0)
  if (!filled.length) return
  e.preventDefault()
  e.stopPropagation()
  open.set({ x: e.clientX, y: e.clientY, label, groups: filled })
}

export function fitted(x: number, y: number, width: number, height: number, roomX: number, roomY: number): { left: number; top: number } {
  return {
    left: Math.max(GUTTER, Math.min(x, roomX - width - GUTTER)),
    top: Math.max(GUTTER, Math.min(y, roomY - height - GUTTER)),
  }
}

export function stepped(key: string, at: number, count: number): number | null {
  if (key === "ArrowDown") return at < 0 || at === count - 1 ? 0 : at + 1
  if (key === "ArrowUp") return at <= 0 ? count - 1 : at - 1
  if (key === "Home") return 0
  if (key === "End") return count - 1
  return null
}

function Menu({ menu }: { menu: OpenMenu }) {
  const box = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState({ left: menu.x, top: menu.y })
  useLayoutEffect(() => {
    const rect = box.current?.getBoundingClientRect()
    if (rect) setPlace(fitted(menu.x, menu.y, rect.width, rect.height, window.innerWidth, window.innerHeight))
    box.current?.querySelector("button")?.focus()
  }, [menu])
  useEffect(() => {
    const close = () => open.set(null)
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !box.current?.contains(e.target)) close()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault()
        e.stopPropagation()
        close()
        return
      }
      const items = [...(box.current?.querySelectorAll("button") ?? [])]
      const next = stepped(e.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
      if (next === null) return
      e.preventDefault()
      items[next]?.focus()
    }
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("keydown", key, true)
    window.addEventListener("blur", close)
    window.addEventListener("resize", close)
    return () => {
      window.removeEventListener("pointerdown", away, true)
      window.removeEventListener("keydown", key, true)
      window.removeEventListener("blur", close)
      window.removeEventListener("resize", close)
    }
  }, [])
  return (
    <div ref={box} className="rail-menu is-at-pointer" role="menu" aria-label={menu.label} style={place}>
      {menu.groups.map((group, g) => (
        <div key={g} className="menu-group" role="group">
          {group.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                open.set(null)
                item.run()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

export function ContextMenus() {
  const menu = useSyncExternalStore(open.subscribe, open.get)
  return menu ? <Menu key={`${menu.x}:${menu.y}:${menu.label}`} menu={menu} /> : null
}
