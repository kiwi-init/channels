import { tmuxPlaceFrom, type TmuxPlace } from "./tmux-pane.ts";

type Env = Record<string, string | undefined>;

export interface RexPlace {
  server: string;
  session: string;
  block: string;
}

export interface SeatPlace {
  tmux?: TmuxPlace;
  rex?: RexPlace;
}

const SERVER = /^[\x21-\x7e]{1,512}$/;
const SESSION = /^session:[0-9a-f-]{36}$/;
const BLOCK = /^block:[0-9a-f-]{36}$/;

function rexPlaceFrom(env: Env): SeatPlace {
  if (env.TERM_PROGRAM?.trim() !== "rex") return {};
  const server = env.REX_SERVER?.trim();
  const session = env.REX_SESSION?.trim();
  const block = env.REX_BLOCK?.trim();
  return server && SERVER.test(server) && session && SESSION.test(session) && block && BLOCK.test(block) ? { rex: { server, session, block } } : {};
}

export function placeFrom(env: Env): SeatPlace {
  return env.TMUX ? tmuxPlaceFrom(env) : rexPlaceFrom(env);
}

export function samePlace(a: SeatPlace, b: SeatPlace): boolean {
  return JSON.stringify([a.tmux ?? null, a.rex ?? null]) === JSON.stringify([b.tmux ?? null, b.rex ?? null]);
}
