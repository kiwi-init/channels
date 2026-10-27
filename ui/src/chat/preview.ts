export function preview(text: string): string {
  const lines = text
    .replace(/```[\s\S]*?(```|$)/g, "\n")
    .split("\n")
    .map((l) => l.replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+)/, "").trim())
    .filter((l) => l && !/^\|.*\|$/.test(l) && !/^[-:| ]+$/.test(l))
  return lines
    .join(" ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
}
