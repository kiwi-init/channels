import type { DoctorFinding } from "./bridge.ts";

const TEXT_MAX = 2_000;
const FINDINGS_MAX = 40;

const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 && v.length <= TEXT_MAX ? v : null);

function readFinding(x: unknown): DoctorFinding | null {
  if (!x || typeof x !== "object") return null;
  const f = x as Record<string, unknown>;
  const what = text(f.what);
  if (!what) return null;
  if (f.ok === true) return { ok: true, what };
  const how = text(f.how);
  return f.ok === false && how ? { ok: false, what, how } : null;
}

export function readDoctorFindings(stdout: string): DoctorFinding[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    // kiwi doctor --json writes one JSON value; anything else is no answer.
    return null;
  }
  const listed = parsed && typeof parsed === "object" ? (parsed as { findings?: unknown }).findings : undefined;
  return Array.isArray(listed)
    ? listed
        .slice(0, FINDINGS_MAX)
        .map(readFinding)
        .filter((f): f is DoctorFinding => f !== null)
    : null;
}
