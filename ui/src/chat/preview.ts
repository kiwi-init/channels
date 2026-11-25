export function preview(text: string): string {
  const lines = text
    .replace(/```[\s\S]*?(```|$)/g, "\n")
    .split("\n")
    .map((l) => l.replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+)/, "").trim())
    .filter((l) => l && !/^[-:| ]+$/.test(l))
    .map((l) => (/^\|.*\|$/.test(l) ? cells(l) : l))
  return lines
    .join(" ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]*?)`+/g, "$1")
    .replace(/(\*\*|__|~~)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/(^|[^\w*])([*_])(?=\S)(.+?)(?<=\S)\2(?![\w*])/g, "$1$3")
    .replace(/\s+/g, " ")
    .trim()
}

function cells(row: string): string {
  return row
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim())
    .filter(Boolean)
    .join(" · ")
}
