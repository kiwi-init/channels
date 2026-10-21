import { closeSync, openSync, writeSync } from "node:fs";
import type { StatusRecord, TerminalPlace } from "../plugin.ts";

const STATUS_PROGRAMS = new Set(["rex"]);

export function takesStatus(term: TerminalPlace | undefined): boolean {
  return !!term && STATUS_PROGRAMS.has(term.program.toLowerCase());
}

export function aliasSegment(alias: string): string {
  return alias.replace(/[^A-Za-z0-9_.+-]/g, "").slice(0, 32) || "ch";
}

export function askId(alias: string): string {
  return `kiwi/${aliasSegment(alias)}/ask`;
}

export function reviewId(alias: string, task: number): string {
  return `kiwi/${aliasSegment(alias)}/T${task}`;
}

const b64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");
const OSC = "\x1b]7501;";
const ST = "\x1b\\";

export function statusFrame(record: StatusRecord): string {
  const fields = [`state=${record.state}`, ...(record.kind ? [`kind=${record.kind}`] : []), "app=kiwi", `id=${record.id}`, `title=${b64("Kiwi")}`, `msg=${b64(record.msg)}`];
  return `${OSC}${fields.join(":")}${ST}`;
}

export function clearFrame(id: string): string {
  return `${OSC}state=clear:app=kiwi:id=${id}${ST}`;
}

const MAX_BYTES = 4_096;

export function writeFrames(device: string, frames: string): boolean {
  if (!frames || Buffer.byteLength(frames) > MAX_BYTES) return false;
  let fd: number | null = null;
  try {
    fd = openSync(device, "w");
    writeSync(fd, frames);
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Closing a device that just went away changes nothing: the write already failed or landed.
      }
    }
  }
}
