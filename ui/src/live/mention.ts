const escaped = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const mentions = (body: string, name: string): boolean => new RegExp(`(^|[^\\p{L}\\p{N}_.-])@${escaped(name)}(?![\\p{L}\\p{N}_-])`, "u").test(body)
