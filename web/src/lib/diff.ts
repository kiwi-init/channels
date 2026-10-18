export function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git")) return "font-semibold text-ink"
  if (line.startsWith("@@")) return "text-ink-3"
  if (line.startsWith("+")) return "border-l-2 border-live pl-2 text-ink"
  if (line.startsWith("-")) return "border-l-2 border-alert pl-2 text-ink-2"
  return "pl-2.5 text-ink-2"
}

export interface FileStat {
  path: string
  additions: number
  deletions: number
}

export function fileStats(diff: string): FileStat[] {
  const out: FileStat[] = []
  let at: FileStat | undefined
  for (const line of diff.split("\n")) {
    const head = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
    if (head) {
      at = { path: head[2]!, additions: 0, deletions: 0 }
      out.push(at)
    } else if (!at || line.startsWith("+++") || line.startsWith("---")) continue
    else if (line.startsWith("+")) at.additions++
    else if (line.startsWith("-")) at.deletions++
  }
  return out
}
