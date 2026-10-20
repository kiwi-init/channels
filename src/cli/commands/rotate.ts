import * as Effect from "effect/Effect";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONTEXT_LINE } from "@kiwi/core/protocol.ts";
import { tokensWord } from "@kiwi/core/format.ts";
import { Keystore, loadConfig } from "../../config.ts";
import { ROTATE_FLOOR } from "../../rotate/decide.ts";
import { args } from "../args.ts";
import { type Command, die, out } from "../context.ts";

const USAGE = "usage: kiwi rotate on|off|status";

function statusText(on: boolean): string {
  return on
    ? `rotation is on for this computer: a Claude Code or Codex seat running in tmux gets a fresh session (/clear, or Codex's /new and a first prompt, typed into its pane once it is idle and nobody is typing) between tasks past ${tokensWord(ROTATE_FLOOR)}, the lead past ${tokensWord(CONTEXT_LINE)} once it has written its lead checkpoint, and a seat with open tasks past ${tokensWord(CONTEXT_LINE)} once it has checkpointed them. Log: ~/.kiwi/rotate.log`
    : "rotation is off for this computer (kiwi rotate on turns it on; nothing of it is loaded while off)";
}

export const rotateCommands: Record<string, Command> = {
  rotate: () =>
    Effect.gen(function* () {
      const sub = args[1] ?? "status";
      if (sub === "status") return out(statusText(loadConfig().rotate === "on"));
      if (sub === "on" || sub === "off") {
        const keys = yield* Keystore;
        yield* keys.update((c) => {
          c.rotate = sub;
        });
        return out(statusText(sub === "on"));
      }
      if (sub === "send") {
        const pid = Number(args[2]);
        const [session, pane, socket, harness, rollout, cwd, name] = [args[3], args[4], args[5], args[6], args[7], args[8], args[9]];
        const usage = "usage: kiwi rotate send PID SESSION PANE SOCKET [codex ROLLOUT CWD NAME] (the Stop hook runs it)";
        if (!Number.isInteger(pid) || pid <= 0 || !session || !pane || !socket) return yield* die(usage);
        if (harness !== undefined && (harness !== "codex" || !rollout || !cwd || !name)) return yield* die(usage);
        if (loadConfig().rotate !== "on") return 0;
        const { clearWhenIdle } = yield* Effect.promise(() => import("../../rotate/pane.ts"));
        const { sessionMeta } = yield* Effect.promise(() => import("../../rotate/codex.ts"));
        const seat = { pid, session, pane, socket };
        const by = harness === "codex" && rollout ? sessionMeta(rollout)?.originator : undefined;
        if (harness === "codex" && !by) return 1;
        const target =
          harness === "codex" && rollout && cwd && name && by
            ? { ...seat, harness: "codex" as const, cwd, thread: { kind: "old" as const, rollout, name, by } }
            : { ...seat, harness: "claude" as const, claudeDir: process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude") };
        const outcome = yield* Effect.promise(() => clearWhenIdle(target, { on: () => loadConfig().rotate === "on" }));
        return outcome === "cleared" ? 0 : 1;
      }
      return yield* die(USAGE);
    }),
};
