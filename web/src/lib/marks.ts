export function markOnce(name: string): void {
  if (typeof performance === "undefined" || performance.getEntriesByName(name, "mark").length) return
  performance.mark(name)
}
