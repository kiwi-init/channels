import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { home, writePrivate } from "../config.ts";
import { upLaunch } from "../hold.ts";

const fileOf = (key: string): string => join(home(), "up", `${key}.seen`);

export function noteLaunchSeen(seats: readonly { alias: string; as: string }[], session: string | undefined, env: Record<string, string | undefined> = process.env): void {
  const key = upLaunch(env);
  if (!key || !session || !seats.length) return;
  writePrivate(fileOf(key), JSON.stringify({ session, seats: seats.map((s) => ({ alias: s.alias, as: s.as })) }));
}

export function launchSeen(key: string, alias: string, as: string): string | null {
  try {
    const seen: unknown = JSON.parse(readFileSync(fileOf(key), "utf8"));
    if (typeof seen !== "object" || seen === null || !("session" in seen) || !("seats" in seen) || typeof seen.session !== "string" || !Array.isArray(seen.seats)) return null;
    const found = seen.seats.some((s: unknown) => typeof s === "object" && s !== null && "alias" in s && "as" in s && s.alias === alias && s.as === as);
    return found ? seen.session : null;
  } catch {
    // No hook of this launch has run yet (or its note is torn): nothing seen.
    return null;
  }
}

export function forgetLaunch(key: string): void {
  rmSync(fileOf(key), { force: true });
}

export type Report = { result: "restored" | "running" | "failed"; why: string };

const REPORT_ID = /^[a-f0-9]{16,64}$/;

const reportOf = (id: string): string => join(home(), "up", `report-${id}.json`);

export function isReportId(id: string): boolean {
  return REPORT_ID.test(id);
}

export function writeReport(id: string, report: Report): void {
  if (isReportId(id)) writePrivate(reportOf(id), JSON.stringify(report));
}

export function readReport(id: string): Report | null {
  try {
    const r: unknown = JSON.parse(readFileSync(reportOf(id), "utf8"));
    if (typeof r !== "object" || r === null || !("result" in r) || !("why" in r) || typeof r.why !== "string") return null;
    return r.result === "restored" || r.result === "running" || r.result === "failed" ? { result: r.result, why: r.why } : null;
  } catch {
    // The seat's own kiwi up hasn't reported yet.
    return null;
  }
}

export function forgetReport(id: string): void {
  rmSync(reportOf(id), { force: true });
}
