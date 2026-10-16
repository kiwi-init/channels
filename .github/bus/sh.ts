export type Ran = { ok: boolean; out: string; err: string }

export function run(cmd: string[], cwd: string, env?: Record<string, string>): Ran {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } })
  return { ok: p.success, out: p.stdout.toString(), err: p.stderr.toString() }
}

const redact = (text: string) => text.replace(/(AUTHORIZATION: basic )\S+/gi, "$1***")

export function must(cmd: string[], cwd: string, env?: Record<string, string>): string {
  const r = run(cmd, cwd, env)
  if (!r.ok) throw new Error(`${redact(cmd.join(" "))}: ${redact((r.err || r.out).trim()).slice(0, 2000)}`)
  return r.out
}

export const clip = (text: string, lines: number) => {
  const all = text.split("\n")
  return all.length > lines ? [...all.slice(0, lines), `… ${all.length - lines} more lines`].join("\n") : text
}
