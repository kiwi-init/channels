export function git(repo: string, args: string[]): string {
  const p = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" })
  if (!p.success) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString().trim()}`)
  return p.stdout.toString()
}

export function hasCommit(repo: string, sha: string): boolean {
  return Bun.spawnSync(["git", "-C", repo, "cat-file", "-e", `${sha}^{commit}`]).success
}
