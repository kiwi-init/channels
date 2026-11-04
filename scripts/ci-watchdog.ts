export const SILENT_MS = 120_000;

export interface Watch {
  reported: Set<string>;
  failed: boolean;
  summary: boolean;
  lastOutputAt: number;
}

const ANSI = /\x1b\[[0-9;]*m/g;
const HEADER = /^(?:##\[group\]|::group::)?(?:\.\/)?((?:test|ui\/src|packages)\/\S+\.test\.tsx?):\s*$/;

export function watching(now: number): Watch {
  return { reported: new Set(), failed: false, summary: false, lastOutputAt: now };
}

export function noteLine(w: Watch, raw: string, now: number): void {
  const line = raw.replace(ANSI, "").trimEnd();
  w.lastOutputAt = now;
  const header = HEADER.exec(line);
  if (header?.[1]) w.reported.add(header[1]);
  if (line.startsWith("(fail) ")) w.failed = true;
  if (/^Ran \d+ tests? across \d+ files?\./.test(line)) w.summary = true;
}

function missing(files: readonly string[], w: Watch): string[] {
  return files.filter((f) => !w.reported.has(f));
}

export function shouldKill(files: readonly string[], w: Watch, now: number, silentMs = SILENT_MS): boolean {
  return !w.summary && missing(files, w).length === 0 && now - w.lastOutputAt >= silentMs;
}

export function verdict(files: readonly string[], w: Watch): { code: 1; why: string } {
  const gone = missing(files, w);
  if (w.failed) return { code: 1, why: "a test failed, and bun never finished" };
  if (gone.length) return { code: 1, why: `${gone.length} file${gone.length === 1 ? "" : "s"} never started: ${gone.join(", ")}` };
  return { code: 1, why: "bun never finished: a file's header says it started, not that its tests passed, so a killed run fails; rerun the job" };
}
