export function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git")) return "font-semibold text-ink"
  if (line.startsWith("@@")) return "text-ink-3"
  if (line.startsWith("+")) return "border-l-2 border-live pl-2 text-ink"
  if (line.startsWith("-")) return "border-l-2 border-alert pl-2 text-ink-2"
  return "pl-2.5 text-ink-2"
}
