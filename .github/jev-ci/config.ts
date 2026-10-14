export type Job = {
  /** The job's display name in CI. */
  name?: string
  /** Files the job reads. A change outside these can't affect it. */
  inputs: string[]
  /** Files that run the job by rule when changed: config and dependencies. */
  always?: string[]
  /** What the job checks and what makes it fail, in plain words. Jev reads this. */
  description: string
  /** false: never ask Jev; the job runs whenever a file it reads changed. For static checks (types, lint), where any edit can fail them. */
  jev?: boolean
}

export type Config = {
  /** enforce: Jev's skips happen. shadow: every job Jev would skip still runs, and the plan says so. */
  mode?: "enforce" | "shadow"
  /** The workflow file. A change to it runs only the jobs whose definition changed. */
  workflow?: string
  /** Jobs in the workflow that aren't checks (the planner, the gate): changing them runs everything. */
  planner_jobs?: string[]
  run_all_when_changed?: string[]
  version_only?: { files: string[]; pattern: string }
  /** Generated files: Jev is told they were regenerated instead of reading them. */
  summarize_files?: string[]
  max_jev_lines: number
  max_file_lines: number
  threshold: number
  jobs: Record<string, Job>
}

export async function loadConfig(path: string): Promise<Config> {
  return Bun.YAML.parse(await Bun.file(path).text()) as Config
}

const globs = new Map<string, Bun.Glob>()
export function matches(patterns: string[] | undefined, path: string): boolean {
  return (patterns ?? []).some((p) => {
    let g = globs.get(p)
    if (!g) globs.set(p, (g = new Bun.Glob(p)))
    return g.match(path)
  })
}
