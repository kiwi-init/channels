import { chmodSync, existsSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";

export function put(file: string, text: string): boolean {
  if (existsSync(file) && readFileSync(file, "utf8") === text) return false;
  writeFileSync(file, text, { mode: 0o600 });
  return true;
}

export function replaceFile(file: string, text: string): void {
  const target = existsSync(file) ? realpathSync(file) : file;
  const mode = existsSync(target) ? statSync(target).mode & 0o777 : 0o600;
  const tmp = `${target}.kiwi-${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, target);
}

export function hasLine(text: string, line: string): boolean {
  return text.split("\n").some((l) => l.trim() === line);
}

export function withLine(text: string, line: string): string {
  return text && !text.endsWith("\n") ? `${text}\n${line}\n` : `${text}${line}\n`;
}

export function withoutLine(text: string, line: string): string {
  return text
    .split("\n")
    .filter((l) => l.trim() !== line)
    .join("\n");
}
