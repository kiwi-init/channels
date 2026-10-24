import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { Opened, PlaceKind } from "@kiwi/core/terminals.ts";
import { loadConfig, type Config } from "../config.ts";
import type { Pane, PlaceRequest, Placed, PlaceTools, TerminalId, TerminalPlugin } from "../terminals/plugin.ts";
import { placeTools, preferred, terminalPlugins } from "../terminals/registry.ts";

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

export async function placeKind(tools?: PlaceTools, cfg: Pick<Config, "terminals"> = loadConfig()): Promise<PlaceKind | null> {
  const picked = await pick(await terminalPlugins(tools ?? (await placeTools())), cfg);
  return picked ? KIND[picked.plugin.manifest.id] : null;
}

export async function paneOf(placed: Opened, tools?: PlaceTools): Promise<Pane | null> {
  const plugins = await terminalPlugins(tools ?? (await placeTools()));
  const typer = (id: TerminalId) => plugins.find((p) => p.manifest.id === id)?.type;
  if (placed.place === "rex") return typer("rex")?.({ rex: placed.rex }) ?? null;
  if (placed.place === "tmux") return typer("tmux")?.({ tmux: { socket: placed.socket, pane: placed.pane } }) ?? null;
  return null;
}

export async function openPlace(req: PlaceRequest, tools?: PlaceTools, cfg: Pick<Config, "terminals"> = loadConfig()): Promise<Placed> {
  const bad = badRequest(req);
  if (bad) return { ok: false, why: "bad-request", detail: bad };
  const picked = await pick(await terminalPlugins(tools ?? (await placeTools())), cfg);
  if (!picked) return { ok: false, why: "no-place", detail: "No terminal to open: install tmux, or run kiwi join yourself" };
  const placed = await picked.plugin.open!(req);
  return placed.ok && picked.instead ? { ...placed, instead: picked.instead } : placed;
}

async function pick(plugins: TerminalPlugin[], cfg: Pick<Config, "terminals">): Promise<{ plugin: TerminalPlugin; instead?: string } | null> {
  const want = plugins.find((p) => p.manifest.id === preferred(cfg));
  const why = want ? await missing(want) : null;
  if (want && !why) return { plugin: want };
  for (const id of ["app", "tmux"] as const) {
    const plugin = plugins.find((p) => p.manifest.id === id);
    if (!plugin || plugin === want || (await missing(plugin))) continue;
    return why && want?.manifest.id !== "app" ? { plugin, instead: `${why}, so it opened in ${plugin.manifest.name}` } : { plugin };
  }
  return null;
}

async function missing(plugin: TerminalPlugin): Promise<string | null> {
  if (!plugin.open) return `${plugin.manifest.name} can't open windows`;
  const found = await plugin.detect();
  return !found.found ? `${plugin.manifest.name} isn't installed` : !found.running ? `${plugin.manifest.name} isn't running` : null;
}
