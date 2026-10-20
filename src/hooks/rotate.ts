import * as Effect from "effect/Effect";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { openSession } from "../agent.ts";
import { loadConfig } from "../config.ts";
import { rotationAt } from "../rotate/decide.ts";
import type { Here } from "../seats.ts";
import { placeFrom, rexBinary, type RexPlace } from "../rex.ts";
import type { HookInput } from "./answer.ts";
import { overLineSince } from "./context-line.ts";
import type { Served } from "./listen.ts";

interface TmuxPane {
  pane: string;
  socket: string;
}

interface RexPane {
  kind: "rex";
  rex: RexPlace;
  bin: string;
}

export type PaneOf = TmuxPane | RexPane;

export function paneOf(env: Record<string, string | undefined>): PaneOf | null {
  const pane = env.TMUX_PANE;
  const socket = env.TMUX?.split(",")[0];
  if (pane && /^%\d+$/.test(pane) && socket) return { pane, socket };
  const rex = placeFrom(env).rex;
  if (!rex) return null;
  const dir = env.REX_BIN_DIR?.trim();
  const bin = dir ? join(dir, "rex") : rexBinary();
  return bin ? { kind: "rex", rex, bin } : null;
}

export function rotateArgv(pid: number, session: string, where: PaneOf): string[] {
  const main = process.argv[1];
  const head = [process.execPath, ...(main && (main.endsWith(".ts") || main.endsWith(".js")) ? [main] : []), "rotate", "send", String(pid), session];
  if ("pane" in where) return [...head, where.pane, where.socket];
  return [...head, "rex", where.rex.server, where.rex.session, where.rex.block, where.bin];
}

export const rotateAfterStop = Effect.fn("Hooks.rotateAfterStop")(function* (input: HookInput, served: readonly Served[], who: Here) {
  const session = input.session_id;
  const file = input.transcript_path;
  const where = paneOf(process.env);
  if (who.harness !== "claude" || input.stop_hook_active || !who.pid || !session || typeof file !== "string" || !where || !served.length) return;
  if (loadConfig().rotate !== "on") return;
  const teller = "pane" in where ? { pid: who.pid, session, pane: where.pane } : { pid: who.pid, session, rex: where.rex };
  const { claudeContext } = yield* Effect.promise(() => import("../harness.ts"));
  const used = yield* Effect.sync(() => {
    try {
      return claudeContext(file)?.used;
    } catch {
      // An unreadable transcript says nothing about the context: no rotation.
      return undefined;
    }
  });
  for (const { b, cfg } of served) {
    const s = yield* openSession(b.alias, cfg, b.as);
    const { state } = yield* s.state();
    const decided = rotationAt(state, b.as, used, overLineSince(b.alias, b.as, session));
    if (decided.kind === "stay") {
      const { noteStay } = yield* Effect.promise(() => import("../rotate/pane.ts"));
      yield* Effect.sync(() => noteStay(teller, `${b.alias}/${b.as}`, decided.why));
      return;
    }
  }
  const { forgetStay, rotating } = yield* Effect.promise(() => import("../rotate/pane.ts"));
  yield* Effect.sync(() => forgetStay(session));
  if (rotating(session)) return;
  const argv = rotateArgv(who.pid, session, where);
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
