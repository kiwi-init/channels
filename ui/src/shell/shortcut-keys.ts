const mod = (e: KeyboardEvent): boolean => (e.metaKey || e.ctrlKey) && !e.altKey

export const isSheetKey = (e: KeyboardEvent): boolean => mod(e) && (e.key === "/" || e.key === "?" || (e.code === "Slash" && !e.shiftKey))

export function railDigit(e: KeyboardEvent): number | null {
  if (!mod(e) || e.shiftKey) return null
  const digit = /^Digit([1-9])$/.exec(e.code)?.[1] ?? /^[1-9]$/.exec(e.key)?.[0]
  return digit ? Number(digit) : null
}

export const byDigit = <T>(list: readonly T[], n: number): T | null => (n === 9 ? list.at(-1) : list[n - 1]) ?? null

export const onMac = (): boolean => /Mac|iPhone|iPad/.test(`${navigator.platform} ${navigator.userAgent}`)

export const sheetKeys = (): string => (onMac() ? "⌘/" : "Ctrl+/")
