import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function readJson(p: string): Record<string, unknown> {
  if (!existsSync(p)) return {};
  const parsed: unknown = JSON.parse(readFileSync(p, "utf8"));
  if (!isRecord(parsed)) throw new Error("not a JSON object");
  return parsed;
}

export function writeJson(p: string, value: unknown): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseToml(text: string): Record<string, unknown> {
  const parsed: unknown = Bun.TOML.parse(text);
  if (!isRecord(parsed)) throw new Error("not a TOML table");
  return parsed;
}
