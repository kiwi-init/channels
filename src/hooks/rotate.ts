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

export type Codex = { rollout: string; cwd: string; name: string };

export type CodexPane = TmuxPane & { codex: Codex };

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

export function rotateArgv(pid: number, session: string, where: PaneOf | CodexPane): string[] {
  const main = process.argv[1];
  const head = [process.execPath, ...(main && (main.endsWith(".ts") || main.endsWith(".js")) ? [main] : []), "rotate", "send", String(pid), session];
  if ("codex" in where) return [...head, where.pane, where.socket, "codex", where.codex.rollout, where.codex.cwd, where.codex.name];
  if ("pane" in where) return [...head, where.pane, where.socket];
  return [...head, "rex", where.rex.server, where.rex.session, where.rex.block, where.bin];
}

type Spot = { pid: number; where: PaneOf | CodexPane; used: number | undefined };

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
  if (who.harness !== "claude" && who.harness !== "codex") return;
  const config = loadConfig();
  if (config.rotate !== "on") return;
  let spot: Spot;
  if (who.harness === "claude") {
    const where = paneOf(process.env);
    if (!who.pid || !where || (!("pane" in where) && config.rex !== "on")) return;
    const { claudeContext } = yield* Effect.promise(() => import("../harness.ts"));
    spot = { pid: who.pid, where, used: used(claudeContext, file) };
  } else {
    if (!cwd) return;
    const { codexContext } = yield* Effect.promise(() => import("../harness.ts"));
    const { noteStay } = yield* Effect.promise(() => import("../rotate/pane.ts"));
    const { codexHome, codexPane, sessionMeta, sockets, threadName } = yield* Effect.promise(() => import("../rotate/codex.ts"));
    const found = yield* Effect.sync(() => codexPane(cwd, sockets(process.env)));
    if (!found) {
      yield* Effect.sync(() => noteStay({ pid: 0, session, pane: "none" }, `${first.b.alias}/${first.b.as}`, `no single Codex window in tmux has ${cwd} open`));
      return;
    }
    const name = threadName(codexHome(file), session);
    if (!name || !sessionMeta(file)) {
      const why = !name
        ? "Codex has not named this thread yet, so its window's title can't show it is the one open"
        : "its rollout doesn't start with the session_meta its new thread is matched against";
      yield* Effect.sync(() => noteStay({ pid: found.pid, session, pane: found.pane }, `${first.b.alias}/${first.b.as}`, why));
      return;
    }
    spot = { pid: found.pid, where: { pane: found.pane, socket: found.socket, codex: { rollout: file, cwd, name } }, used: used(codexContext, file) };
  }
  const where = spot.where;
  const teller = "pane" in where ? { pid: spot.pid, session, pane: where.pane } : { pid: spot.pid, session, rex: where.rex };
  for (const { b, cfg } of served) {
    const s = yield* openSession(b.alias, cfg, b.as);
    const { state } = yield* s.state();
    const decided = rotationAt(state, b.as, spot.used, overLineSince(b.alias, b.as, session));
    if (decided.kind === "stay") {
      const { noteStay } = yield* Effect.promise(() => import("../rotate/pane.ts"));
      yield* Effect.sync(() => noteStay(teller, `${b.alias}/${b.as}`, decided.why));
      return;
    }
  }
  const { forgetStay, rotating } = yield* Effect.promise(() => import("../rotate/pane.ts"));
  yield* Effect.sync(() => forgetStay(session));
  if (rotating(session)) return;
  const argv = rotateArgv(spot.pid, session, where);
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
