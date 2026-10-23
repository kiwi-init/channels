import fs from "node:fs";
import path from "node:path";

import { host } from "./host.ts";

function errorLine(err: unknown, at: Date): string {
  const text = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err);
  return `${at.toISOString()} ${text.replace(/\n/g, "\n  ")}\n`;
}

const logFile = (): string => path.join(host().app.path("logs"), "main.log");

export function logMainError(err: unknown): void {
  try {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true });
    fs.appendFileSync(logFile(), errorLine(err, new Date()));
  } catch {
    // Nowhere left to write it; the app keeps running either way.
  }
}
