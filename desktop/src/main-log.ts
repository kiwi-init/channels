import fs from "node:fs";
import path from "node:path";

import { host } from "./host.ts";

export function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const head = err.message ? `${err.name}: ${err.message}` : err.name;
  const stack = err.stack ?? "";
  if (stack.startsWith(head)) return stack;
  return stack ? `${head}\n${stack}` : head;
}

function errorLine(err: unknown, at: Date): string {
  return `${at.toISOString()} ${errorText(err).replace(/\n/g, "\n  ")}\n`;
}

export const logFile = (): string => path.join(host().app.path("logs"), "main.log");

export const MAIN_LOG_KEEP_BYTES = 1_000_000;

function append(text: string): void {
  try {
    const file = logFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if ((fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAIN_LOG_KEEP_BYTES) fs.renameSync(file, `${file}.1`);
    fs.appendFileSync(file, text);
  } catch {
    // Nowhere left to write it; the app keeps running either way.
  }
}

export const logMainError = (err: unknown): void => append(errorLine(err, new Date()));

export const logMainLine = (line: string, at: Date = new Date()): void => append(`${at.toISOString()} ${line.replace(/\s*\n\s*/g, " ")}\n`);

export function catchMainErrors(): void {
  process.on("uncaughtException", logMainError);
  process.on("unhandledRejection", logMainError);
}
