import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { Opened } from "@kiwi/core/terminals.ts";
import type { Pane, PlaceRequest, Placed } from "../terminals/plugin.ts";

const CONTROL = /[\x00-\x1f\x7f]/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface Ended {
  code: number | null;
  tail: string[];
}

export interface Hosted {
  ready(): Promise<string | null>;
  open(req: PlaceRequest): Promise<Placed>;
  pane(pane: string): Pane | null;
  ended?(pane: string): Promise<Ended | null>;
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function badRequest(req: PlaceRequest): string | null {
  const program = req.argv[0];
  if (!program) return "nothing to run";
  if (program.startsWith("-") || program.includes("=")) return `"${program}" is not a program`;
  if (req.argv.some((arg) => CONTROL.test(arg))) return "the command has a control character";
  if (!req.name || req.name.length > 64 || CONTROL.test(req.name)) return "the window's name is empty, too long or has a control character";
  if (!isAbsolute(req.folder) || CONTROL.test(req.folder) || !isDir(req.folder)) return `${req.folder} is not a folder`;
  for (const [key, value] of Object.entries(req.env ?? {})) if (!ENV_KEY.test(key) || CONTROL.test(value)) return `the variable ${key} can't be set`;
  return null;
}

export function paneOf(placed: Opened, hosted: Hosted): Pane | null {
  return hosted.pane(placed.pane);
}

export async function openHosted(req: PlaceRequest, hosted: Hosted): Promise<Placed> {
  const bad = badRequest(req);
  return bad ? { ok: false, why: "bad-request", detail: bad } : hosted.open(req);
}
