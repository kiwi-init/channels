export function detailParts(title: string, detail: string | undefined): { title: string; body: string } {
  if (!detail) return { title, body: "" }
  const text = detail.replace(/\r\n?/g, "\n")
  const [first = "", ...rest] = text.split("\n")
  const head = first.trim()
  const cut = title.replace(/…$/, "").trim()
  const repeats = head !== "" && (head === title.trim() || (title.trim().endsWith("…") && cut !== "" && head.startsWith(cut)))
  if (!repeats) return { title, body: text.trim() }
  return { title: head, body: rest.join("\n").trim() }
}
