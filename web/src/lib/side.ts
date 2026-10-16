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
