const OPEN = "mc.side.open"

export function remembered(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "0"
  } catch {
    return true
  }
}

export function remember(key: string, open: boolean): void {
  try {
    localStorage.setItem(key, open ? "1" : "0")
  } catch {
    return
  }
}

export function sideStartsOpen(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 1100px)").matches && remembered(OPEN)
}

export const keepSideOpen = (open: boolean): void => remember(OPEN, open)
