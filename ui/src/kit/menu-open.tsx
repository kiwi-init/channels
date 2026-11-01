import { lazy, Suspense, useSyncExternalStore, type MouseEvent } from "react"

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
}

export const openMenu = store<OpenMenu | null>(null)

const View = lazy(() => import("~/kit/context-menu"))

export function showMenu(e: MouseEvent, label: string, make: (menus: typeof import("~/chat/menus")) => MenuGroups): void {
  if (nativeMenuAllowed(e.target, selectedBeforePress())) return
  e.preventDefault()
  e.stopPropagation()
  document.getSelection()?.removeAllRanges()
  const { clientX: x, clientY: y } = e
  void import("~/chat/menus").then((menus) => {
    const groups = make(menus).filter((g) => g.length > 0)
    if (groups.length) openMenu.set({ x, y, label, groups })
  })
}

export function ContextMenus() {
  const menu = useSyncExternalStore(openMenu.subscribe, openMenu.get)
  return menu ? (
    <Suspense fallback={null}>
      <View key={`${menu.x}:${menu.y}:${menu.label}`} menu={menu} />
    </Suspense>
  ) : null
}
