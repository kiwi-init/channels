import { lazy, Suspense, useSyncExternalStore, type MouseEvent } from "react"

import { Icon } from "~/kit/icons"
import { nativeMenuAllowed, selectedBeforePress } from "~/kit/native-menu"
import { store } from "~/live/value"

export interface MenuItem {
  label: string
  run: () => void
  confirm?: { title: string; sub: string; yes: string }
}

export type MenuGroups = readonly (readonly MenuItem[])[]

export interface OpenMenu {
  x: number
  y: number
  label: string
  groups: MenuGroups
  above?: true
}

export const openMenu = store<OpenMenu | null>(null)

const View = lazy(() => import("~/kit/context-menu"))

export function showMenu(e: MouseEvent, label: string, make: (menus: typeof import("~/chat/menus")) => MenuGroups): void {
  if (nativeMenuAllowed(e.target, selectedBeforePress())) return
  e.preventDefault()
  e.stopPropagation()
  document.getSelection()?.removeAllRanges()
  const { clientX: x, clientY: y } = e
  const open = (menus: typeof import("~/chat/menus")) => {
    const groups = make(menus).filter((g) => g.length > 0)
    if (groups.length) openMenu.set({ x, y, label, groups })
  }
  void import("~/chat/menus").then(open)
}

function showMenuBelow(el: HTMLElement, label: string, groups: MenuGroups): void {
  const shown = groups.filter((g) => g.length > 0)
  if (!shown.length) return
  const at = el.getBoundingClientRect()
  openMenu.set({ x: at.left, y: at.bottom + 4, label, groups: shown })
}

export function MoreButton({ label, groups }: { label: string; groups: () => MenuGroups }) {
  return (
    <button type="button" className="icon-btn" aria-label={`More for ${label}`} title="More" aria-haspopup="menu" onClick={(e) => showMenuBelow(e.currentTarget, label, groups())}>
      <Icon name="more" />
    </button>
  )
}

export function ContextMenus() {
  const menu = useSyncExternalStore(openMenu.subscribe, openMenu.get)
  return menu ? (
    <Suspense fallback={null}>
      <View key={`${menu.x}:${menu.y}:${menu.label}`} menu={menu} />
    </Suspense>
  ) : null
}
