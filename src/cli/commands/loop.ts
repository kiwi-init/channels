import * as Effect from "effect/Effect";
import { loadConfig } from "../../config.ts";
import { newSeatToken, SEAT_TOKEN } from "../../hold.ts";
import { loginPath } from "../../launch/shell.ts";
import { runLoop } from "../../loop/run.ts";
import { opt } from "../args.ts";
import { type Command, config, die, keepDaemon } from "../context.ts";
import { seatNamed } from "./seat.ts";

const USAGE = "usage: kiwi loop [--model ID] [--effort LEVEL] (in a tmux window, from the seat's folder)";

export const loopCommands: Record<string, Command> = {
  loop: () =>
    Effect.gen(function* () {
      const harness = opt.harness ?? "claude";
      if (harness !== "claude") return yield* die(`${USAGE}: the loop starts Claude Code only so far, not ${harness}`);
      if (loadConfig().rotate === "on") return yield* die("rotation is on for this computer, and its Stop hook would clear the loop's sessions: run kiwi rotate off first");
      const bin = Bun.which("claude", { PATH: yield* Effect.promise(() => loginPath()) });
      if (!bin) return yield* die("claude isn't on your login shell's PATH");
      const { alias, name } = yield* seatNamed;
      const cfg = (yield* config).channels[alias];
      if (!cfg) return yield* die(`unknown channel "${alias}" (see: kiwi channels)`);
      yield* keepDaemon;
      const stop = { asked: false, busy: false };
      const asked = () => void (stop.asked = true);
      process.on("SIGINT", () => {
        if (!stop.busy) asked();
      });
      process.on("SIGTERM", asked);
      process.on("SIGHUP", asked);
      const token = process.env[SEAT_TOKEN] || newSeatToken();
      yield* runLoop({ alias, cfg, me: name, token, bin, ...(opt.model ? { model: opt.model } : {}), ...(opt.effort ? { effort: opt.effort } : {}) }, stop);
    }),
};
