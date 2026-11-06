export interface Findable {
  title: string
  subtitle?: string
  keywords?: string[]
}

export function filtered<T extends Findable, S extends { items: T[] }>(sections: S[], query: string): S[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return sections
  const fits = (item: T): boolean => {
    const hay = [item.title, item.subtitle ?? "", ...(item.keywords ?? [])].join(" ").toLowerCase()
    return words.every((w) => hay.includes(w))
  }
  return sections.map((s) => ({ ...s, items: s.items.filter(fits) })).filter((s) => s.items.length > 0)
}
