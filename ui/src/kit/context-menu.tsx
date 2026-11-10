import "~/i18n/en/github-later"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import { Confirm } from "~/kit/confirm"
import { openMenu, type MenuItem, type OpenMenu } from "~/kit/menu-open"

const GUTTER = 8

export function fitted(x: number, y: number, width: number, height: number, roomX: number, roomY: number): { left: number; top: number } {
  return {
    left: Math.max(GUTTER, Math.min(x, roomX - width - GUTTER)),
    top: Math.max(GUTTER, Math.min(y, roomY - height - GUTTER)),
  }
}

export const placed = (menu: Pick<OpenMenu, "x" | "y" | "above">, width: number, height: number, roomX: number, roomY: number): { left: number; top: number } =>
  fitted(menu.x, menu.above ? menu.y - height - 6 : menu.y, width, height, roomX, roomY)

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
  const [typed, setTyped] = useState(menu.field?.value ?? "")
  const latest = useRef(typed)
  const leave = useCallback(
    (keep: boolean) => {
      if (keep && menu.field && latest.current.trim() !== menu.field.value) menu.field.save(latest.current)
      openMenu.set(null)
    },
    [menu]
  )
  useLayoutEffect(() => {
    const rect = box.current?.getBoundingClientRect()
    if (rect) setPlace(placed(menu, rect.width, rect.height, window.innerWidth, window.innerHeight))
    ;(box.current?.querySelector("input") ?? box.current)?.focus()
  }, [menu])
  useEffect(() => {
    const close = () => leave(false)
    const away = (e: PointerEvent) => {
      if (document.querySelector("dialog[open]")) return
      if (!(e.target instanceof Node) || !box.current?.contains(e.target)) leave(true)
    }
    const key = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return
      if (e.key === "Escape" || (e.key === "Tab" && !menu.field)) {
        e.preventDefault()
        e.stopPropagation()
        close()
        return
      }
      const items = [...(box.current?.querySelectorAll("button") ?? [])]
      const typing = document.activeElement instanceof HTMLInputElement
      const next = typing && e.key !== "ArrowDown" && e.key !== "ArrowUp" ? null : stepped(e.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
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
  }, [menu, leave])
  if (asking?.confirm)
    return (
      <Confirm
        open
        onClose={() => openMenu.set(null)}
        title={asking.confirm.title}
        sub={asking.confirm.sub}
        action={asking.confirm.yes}
        keep={asking.confirm.no}
        onConfirm={() => {
          openMenu.set(null)
          asking.run()
        }}
      />
    )
  return (
    <div ref={box} tabIndex={-1} className="rail-menu is-at-pointer" role="menu" aria-label={menu.label} style={place}>
      {menu.field && (
        <form
          className="rail-menu-name"
          onSubmit={(e) => {
            e.preventDefault()
            leave(true)
          }}
        >
          <label>
            <span>{menu.field.label}</span>
            <input
              value={typed}
              maxLength={menu.field.max}
              onChange={(e) => {
                latest.current = e.target.value
                setTyped(e.target.value)
              }}
            />
          </label>
        </form>
      )}
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
