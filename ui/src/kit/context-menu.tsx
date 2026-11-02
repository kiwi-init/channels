import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { Dialog, DialogHead } from "~/kit/bits"
import { openMenu, type MenuItem, type OpenMenu } from "~/kit/menu-open"

const GUTTER = 8

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

export default function Menu({ menu }: { menu: OpenMenu }) {
  const box = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState({ left: menu.x, top: menu.y })
  const [asking, setAsking] = useState<MenuItem | null>(null)
  useLayoutEffect(() => {
    const rect = box.current?.getBoundingClientRect()
    if (rect) setPlace(fitted(menu.x, menu.y, rect.width, rect.height, window.innerWidth, window.innerHeight))
    box.current?.focus()
  }, [menu])
  useEffect(() => {
    const close = () => openMenu.set(null)
    const away = (e: PointerEvent) => {
      if (document.querySelector("dialog[open]")) return
      if (!(e.target instanceof Node) || !box.current?.contains(e.target)) close()
    }
    const key = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return
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
  if (asking?.confirm)
    return (
      <Dialog open onClose={() => openMenu.set(null)} label={asking.confirm.title}>
        <DialogHead title={asking.confirm.title} sub={asking.confirm.sub} onClose={() => openMenu.set(null)} />
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={() => openMenu.set(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn is-danger"
            onClick={() => {
              openMenu.set(null)
              asking.run()
            }}
          >
            {asking.confirm.yes}
          </button>
        </div>
      </Dialog>
    )
  return (
    <div ref={box} tabIndex={-1} className="rail-menu is-at-pointer" role="menu" aria-label={menu.label} style={place}>
      {menu.groups.map((group, g) => (
        <div key={g} className="menu-group" role="group">
          {group.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                if (item.confirm) return setAsking(item)
                openMenu.set(null)
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
