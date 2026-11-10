export const SEP = /[\s#@/._:-]/

export function matchAt(text: string, q: string): number {
  let first = -1
  for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) {
    if (i === 0 || SEP.test(text.charAt(i - 1))) return i
    if (first < 0) first = i
  }
  return first
}

export function titleRank(title: string, query: string): number {
  const at = matchAt(title.toLowerCase(), query.trim().toLowerCase())
  if (at === 0) return 0
  if (at > 0 && SEP.test(title.charAt(at - 1))) return 2
  if (at > 0) return 3
  return 5
}
