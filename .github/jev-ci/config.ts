export type Job = {
  name?: string;
  inputs: string[];
  imports_from?: string[];
  always?: string[];
  description: string;
  question?: string;
  criteria?: { true: string; false: string };
  threshold?: number;
  jev?: boolean;
  push?: boolean;
  version_bumps?: boolean;
};

export type Config = {
  mode?: "enforce" | "shadow";
  workflow?: string;
  planner_jobs?: string[];
  run_all_when_changed?: string[];
  version_only?: { files: string[]; pattern: string };
  summarize_files?: string[];
  max_jev_lines: number;
  max_file_lines: number;
  threshold: number;
  jobs: Record<string, Job>;
};

export const CONFIG_PATH = ".github/jev-ci.yml";

export function parseConfig(text: string): Config {
  return Bun.YAML.parse(text) as Config;
}

export async function loadConfig(path: string): Promise<Config> {
  return parseConfig(await Bun.file(path).text());
}

const globs = new Map<string, Bun.Glob>();
export function matches(patterns: string[] | undefined, path: string): boolean {
  return (patterns ?? []).some((p) => {
    let g = globs.get(p);
    if (!g) globs.set(p, (g = new Bun.Glob(p)));
    return g.match(path);
  });
}
