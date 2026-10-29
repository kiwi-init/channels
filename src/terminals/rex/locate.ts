import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SeatPlace } from "../plugin.ts";

type Env = Record<string, string | undefined>;

const PROGRAM = /^[A-Za-z][A-Za-z0-9+._-]{0,31}$/;
const VERSION = /^[\x21-\x7e]{1,64}$/;
const SERVER = /^[\x21-\x7e]{1,512}$/;
const REX_SESSION = /^session:[0-9a-f-]{36}$/;
const REX_BLOCK = /^block:[0-9a-f-]{36}$/;

export function placeFrom(env: Env): SeatPlace {
  if (env.TMUX) return {};
  const program = env.TERM_PROGRAM?.trim();
  const version = env.TERM_PROGRAM_VERSION?.trim();
  const term = program && PROGRAM.test(program) ? { program, ...(version && VERSION.test(version) ? { version } : {}) } : undefined;
  const server = env.REX_SERVER?.trim();
  const session = env.REX_SESSION?.trim();
  const block = env.REX_BLOCK?.trim();
  const rex = program === "rex" && server && SERVER.test(server) && session && REX_SESSION.test(session) && block && REX_BLOCK.test(block) ? { server, session, block } : undefined;
  return { ...(term ? { term } : {}), ...(rex ? { rex } : {}) };
}

const MAC_REX = join(homedir(), "Library", "Application Support", "com.superlogical.rex", "RexServer", "Versions");

function macBinary(): string | null {
  if (process.platform !== "darwin" || !existsSync(MAC_REX)) return null;
  const versions = readdirSync(MAC_REX).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    const bin = join(MAC_REX, v, "Rex Server.app", "Contents", "MacOS", "rex");
    if (existsSync(bin)) return bin;
  }
  return null;
}

export function rexBinary(): string | null {
  return Bun.which("rex") ?? macBinary();
}
