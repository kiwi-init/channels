export interface Note {
  id: string
  title: string
  since: string | null
  toggle: boolean
  needs: string | null
  body: string
}

const ID = /^[a-z0-9-]{1,40}$/
const META = /^- (id|since|toggle|needs): (.+)$/

export function readNotes(md: string): Note[] {
  const out: Note[] = []
  for (const part of md.split(/^## /m).slice(1)) {
    const [head = "", ...lines] = part.split("\n")
    const meta = new Map<string, string>()
    const body: string[] = []
    for (const line of lines) {
      const m = META.exec(line.trim())
      if (m && !body.length) meta.set(m[1]!, m[2]!.trim())
      else if (body.length || line.trim()) body.push(line)
    }
    const id = meta.get("id") ?? ""
    const title = head.trim()
    if (!ID.test(id) || !title || out.some((n) => n.id === id)) continue
    out.push({ id, title, since: meta.get("since") ?? null, toggle: meta.get("toggle") === "off", needs: meta.get("needs") ?? null, body: body.join("\n").replace(/\s+/g, " ").trim() })
  }
  return out
}
