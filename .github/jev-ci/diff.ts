import { git } from "./git.ts"

export type Hunk = { at: string; removed: string[]; added: string[] }
export type FileChange = {
  path: string
  /** The old path, for a rename. */
  from?: string
  status: "added" | "deleted" | "modified" | "renamed"
  binary: boolean
  hunks: Hunk[]
}

/** Changed lines that matter for judging the file. A deleted file counts as one: what matters is who imported it. */
export function size(f: FileChange): number {
  if (f.status === "deleted") return 1
  const n = f.hunks.reduce((n, h) => n + h.removed.length + h.added.length, 0)
  return f.status === "renamed" ? Math.max(n, 1) : n
}

/** The diff from base to head, ignoring whitespace, with renames detected. */
export function readDiff(repo: string, base: string, head: string): FileChange[] {
  const out = git(repo, ["diff", "-M", "-w", "--no-color", "--no-ext-diff", "--unified=0", base, head])
  const files: FileChange[] = []
  let file: FileChange | undefined
  let hunk: Hunk | undefined
  for (const line of out.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = line.match(/^diff --git a\/(.*) b\/(.*)$/)
      file = { path: m?.[2] ?? line, status: "modified", binary: false, hunks: [] }
      hunk = undefined
      files.push(file)
    } else if (!file) continue
    else if (!hunk) {
      if (line.startsWith("new file mode")) file.status = "added"
      else if (line.startsWith("deleted file mode")) file.status = "deleted"
      else if (line.startsWith("rename from ")) (file.status = "renamed"), (file.from = line.slice(12))
      else if (line.startsWith("Binary files")) file.binary = true
      else if (line.startsWith("@@")) file.hunks.push((hunk = { at: line.replace(/^@@[^@]*@@\s?/, ""), removed: [], added: [] }))
    } else if (line.startsWith("@@")) file.hunks.push((hunk = { at: line.replace(/^@@[^@]*@@\s?/, ""), removed: [], added: [] }))
    else if (line.startsWith("+")) hunk.added.push(line.slice(1))
    else if (line.startsWith("-")) hunk.removed.push(line.slice(1))
  }
  return files
}
