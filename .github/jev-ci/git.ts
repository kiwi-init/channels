export function git(repo: string, args: string[]): string {
  const p = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" })
  if (!p.success) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString().trim()}`)
  return p.stdout.toString()
}

const shown = new Map<string, string | undefined>()

export function show(repo: string, rev: string, path: string): string | undefined {
  const key = `${repo}\0${rev}\0${path}`
  if (shown.has(key)) return shown.get(key)
  const p = Bun.spawnSync(["git", "-C", repo, "show", `${rev}:${path}`], { stdout: "pipe", stderr: "pipe" })
  const text = p.success ? p.stdout.toString() : undefined
  shown.set(key, text)
  return text
}

export function showMany(repo: string, rev: string, paths: string[]): Map<string, string> {
  const out = new Map<string, string>()
  if (!paths.length) return out
  const p = Bun.spawnSync(["git", "-C", repo, "cat-file", "--batch"], {
    stdin: Buffer.from(paths.map((path) => `${rev}:${path}\n`).join("")),
    stdout: "pipe",
    stderr: "pipe",
  })
  if (!p.success) throw new Error(`git cat-file --batch: ${p.stderr.toString().trim()}`)
  const buf = p.stdout
  let at = 0
  for (const path of paths) {
    const nl = buf.indexOf(10, at)
    if (nl < 0) break
    const header = buf.subarray(at, nl).toString()
    at = nl + 1
    const m = header.match(/^\S+ (\S+) (\d+)$/)
    if (!m) continue
    const length = Number(m[2])
    if (m[1] === "blob") out.set(path, buf.subarray(at, at + length).toString())
    at += length + 1
  }
  return out
}

export type Tree = Map<string, string>

export function lsTree(repo: string, rev: string): Tree {
  const tree: Tree = new Map()
  for (const line of git(repo, ["ls-tree", "-r", rev]).split("\n")) {
    const tab = line.indexOf("\t")
    if (tab < 0) continue
    tree.set(line.slice(tab + 1), line.slice(0, tab).split(" ")[2] ?? "")
  }
  return tree
}
