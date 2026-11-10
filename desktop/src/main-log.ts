import fs from "node:fs";
import path from "node:path";

import { host } from "./host.ts";

function errorLine(err: unknown, at: Date): string {
  const text = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err);
  return `${at.toISOString()} ${text.replace(/\n/g, "\n  ")}\n`;
}

export const logFile = (): string => path.join(host().app.path("logs"), "main.log");

export const MAIN_LOG_KEEP_BYTES = 1_000_000;

export function logMainError(err: unknown): void {
  try {
    const file = logFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if ((fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAIN_LOG_KEEP_BYTES) fs.renameSync(file, `${file}.1`);
    fs.appendFileSync(file, errorLine(err, new Date()));
  } catch {
    // Nowhere left to write it; the app keeps running either way.
  }
}

export function catchMainErrors(): void {
  process.on("uncaughtException", logMainError);
  process.on("unhandledRejection", logMainError);
}
