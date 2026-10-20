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
    ? `rotation is on for this computer: a Claude Code seat running in tmux, or in Rex with kiwi rex on, gets a fresh session (/clear typed into its pane once it is idle and nobody is typing) between tasks past ${tokensWord(ROTATE_FLOOR)}, the lead past ${tokensWord(CONTEXT_LINE)}, and a seat with open tasks past ${tokensWord(CONTEXT_LINE)} once it has checkpointed them. Log: ~/.kiwi/rotate.log`
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
        const session = args[3];
        const rex = args[4] === "rex";
        const [pane, socket] = rex ? [undefined, undefined] : [args[4], args[5]];
        const [server, rexSession, block, bin] = rex ? [args[5], args[6], args[7], args[8]] : [undefined, undefined, undefined, undefined];
        const tmuxOk = !!pane && !!socket;
        const rexOk = !!server && !!rexSession && !!block && !!bin;
        if (!Number.isInteger(pid) || pid <= 0 || !session || (!tmuxOk && !rexOk))
          return yield* die("usage: kiwi rotate send PID SESSION (PANE SOCKET | rex SERVER SESSION BLOCK BIN) (the Stop hook runs it)");
        const on = () => {
          const cfg = loadConfig();
          return cfg.rotate === "on" && (!rex || cfg.rex === "on");
        };
        if (!on()) return 0;
        const { clearWhenIdle } = yield* Effect.promise(() => import("../../rotate/pane.ts"));
        const claudeDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
        const target = rex ? { pid, session, claudeDir, rex: { server: server!, session: rexSession!, block: block! }, bin: bin! } : { pid, session, claudeDir, pane: pane!, socket: socket! };
        const outcome = yield* Effect.promise(() => clearWhenIdle(target, { on }));
        return outcome === "cleared" ? 0 : 1;
      }
      return yield* die(USAGE);
    }),
};
