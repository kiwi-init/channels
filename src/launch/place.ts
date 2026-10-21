import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { PlaceKind } from "@kiwi/core/terminals.ts";
import type { PlaceRequest, Placed, PlaceTools, TerminalId } from "../terminals/plugin.ts";
import { placeTools, terminalPlugins } from "../terminals/registry.ts";

const KIND: Record<TerminalId, PlaceKind> = { rex: "rex", tmux: "tmux", app: "terminal" };

const CONTROL = /[\x00-\x1f\x7f]/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

export async function placeKind(tools?: PlaceTools): Promise<PlaceKind | null> {
  for (const plugin of await terminalPlugins(tools ?? (await placeTools()))) if (plugin.open && (await plugin.detect()).running) return KIND[plugin.manifest.id];
  return null;
}

export async function openPlace(req: PlaceRequest, tools?: PlaceTools): Promise<Placed> {
  const bad = badRequest(req);
  if (bad) return { ok: false, why: "bad-request", detail: bad };
  for (const plugin of await terminalPlugins(tools ?? (await placeTools()))) if (plugin.open && (await plugin.detect()).running) return plugin.open(req);
  return { ok: false, why: "no-place", detail: "No terminal to open: install tmux, or run kiwi join yourself" };
}
