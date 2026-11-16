export type UpResult = "restored" | "running" | "skipped" | "failed" | "printed";

export interface UpOutcome {
  channel: string;
  handle: string;
  folder: string;
  result: UpResult;
  why: string;
}

const RESULTS: readonly UpResult[] = ["restored", "running", "skipped", "failed", "printed"];
const TEXT_MAX = 2_000;
const SEATS_MAX = 200;

const text = (v: unknown): string | null => (typeof v === "string" && v.length <= TEXT_MAX ? v : null);

function readOutcome(x: unknown): UpOutcome | null {
  if (typeof x !== "object" || x === null) return null;
  const channel = "channel" in x ? text(x.channel) : null;
  const handle = "handle" in x ? text(x.handle) : null;
  const folder = "folder" in x ? text(x.folder) : null;
  const why = "why" in x ? text(x.why) : null;
  const result = "result" in x ? RESULTS.find((r) => r === x.result) : undefined;
  return channel && handle && folder !== null && why !== null && result ? { channel, handle, folder, result, why } : null;
}

export function readUpOutcomes(stdout: string): UpOutcome[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // kiwi up --json writes one JSON value; anything else is no answer.
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("seats" in parsed) || !Array.isArray(parsed.seats)) return null;
  return parsed.seats.slice(0, SEATS_MAX).flatMap((s: unknown) => {
    const o = readOutcome(s);
    return o ? [o] : [];
  });
}
