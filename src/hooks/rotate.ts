import * as Effect from "effect/Effect";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { openSession } from "../agent.ts";
import { loadConfig } from "../config.ts";
import { rotationAt } from "../rotate/decide.ts";
import type { Here } from "../seats.ts";
import type { HookInput } from "./answer.ts";
import { overLineSince } from "./context-line.ts";
import type { Served } from "./listen.ts";

export interface PaneOf {
  pane: string;
  socket: string;
}

export function paneOf(env: Record<string, string | undefined>): PaneOf | null {
  const pane = env.TMUX_PANE;
  const socket = env.TMUX?.split(",")[0];
  return pane && /^%\d+$/.test(pane) && socket ? { pane, socket } : null;
}

export type Codex = { rollout: string; cwd: string };

export function rotateArgv(pid: number, session: string, where: PaneOf, codex?: Codex): string[] {
  const main = process.argv[1];
  return [
    process.execPath,
    ...(main && (main.endsWith(".ts") || main.endsWith(".js")) ? [main] : []),
    "rotate",
    "send",
    String(pid),
    session,
    where.pane,
    where.socket,
    ...(codex ? ["codex", codex.rollout, codex.cwd] : []),
  ];
}

type Spot = { pid: number; where: PaneOf; codex?: Codex; used: number | undefined };

const used = (read: (file: string) => { used: number } | undefined, file: string): number | undefined => {
  try {
    return read(file)?.used;
  } catch {
    // An unreadable transcript says nothing about the context: no rotation.
    return undefined;
  }
};

export const rotateAfterStop = Effect.fn("Hooks.rotateAfterStop")(function* (input: HookInput, served: readonly Served[], who: Here) {
  const session = input.session_id;
  const file = input.transcript_path;
  const cwd = input.cwd;
  const [first] = served;
  if (input.stop_hook_active || !session || typeof file !== "string" || !file || !first) return;
  const fromEnv = paneOf(process.env);
  const claude = who.harness === "claude" && who.pid && fromEnv ? { pid: who.pid, where: fromEnv } : null;
  const codexIn = who.harness === "codex" && cwd ? cwd : null;
  if (!claude && !codexIn) return;
  if (loadConfig().rotate !== "on") return;
  const read = yield* Effect.promise(() => import("../harness.ts"));
  const { forgetStay, noteStay, rotating } = yield* Effect.promise(() => import("../rotate/pane.ts"));
  let spot: Spot;
  if (claude) spot = { ...claude, used: used(read.claudeContext, file) };
  else if (codexIn) {
    const { codexPane, sockets } = yield* Effect.promise(() => import("../rotate/codex.ts"));
    const found = yield* Effect.sync(() => codexPane(codexIn, sockets(process.env)));
    if (!found) {
      yield* Effect.sync(() => noteStay({ pid: 0, session, pane: "none" }, `${first.b.alias}/${first.b.as}`, `no single Codex window in tmux has ${codexIn} open`));
      return;
    }
    spot = { pid: found.pid, where: { pane: found.pane, socket: found.socket }, codex: { rollout: file, cwd: codexIn }, used: used(read.codexContext, file) };
  } else return;
  const teller = { pid: spot.pid, session, pane: spot.where.pane };
  for (const { b, cfg } of served) {
    const s = yield* openSession(b.alias, cfg, b.as);
    const { state } = yield* s.state();
    const decided = rotationAt(state, b.as, spot.used, overLineSince(b.alias, b.as, session));
    if (decided.kind === "stay") {
      yield* Effect.sync(() => noteStay(teller, `${b.alias}/${b.as}`, decided.why));
      return;
    }
  }
  yield* Effect.sync(() => forgetStay(session));
  if (rotating(session)) return;
  const argv = rotateArgv(spot.pid, session, spot.where, spot.codex);
  yield* Effect.sync(() => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: process.cwd(),
      env: { ...process.env, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude") },
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {});
    child.unref();
  });
});
