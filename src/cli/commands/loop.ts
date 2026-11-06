import * as Effect from "effect/Effect";
import { newSeatToken, SEAT_TOKEN } from "../../hold.ts";
import { loginPath } from "../../login-shell.ts";
import { SESSION_MARKERS } from "../../loop/login-argv.ts";
import { isLoopHarness, LOOP_HARNESSES, recipeFor } from "../../loop/recipes.ts";
import { runLoop } from "../../loop/run.ts";
import { paneIsOurs, tmuxPastesFlag, tmuxVersion } from "../../loop/kimi.ts";
import { tmuxSocket } from "../../loop/tmux.ts";
import { args, opt } from "../args.ts";
import { type Command, config, die, keepDaemon } from "../context.ts";
import { seatNamed } from "./seat.ts";

const USAGE = `usage: kiwi loop [--harness ${LOOP_HARNESSES.join("|")}] [--model ID] [--effort LEVEL] (from the seat's folder)`;

function typedPaneOk(): boolean {
  const socket = tmuxSocket(process.env);
  const pane = process.env.TMUX_PANE;
  return !!socket && !!pane && paneIsOurs(socket, pane);
}

function typedTmuxOld(): string | null {
  const socket = tmuxSocket(process.env);
  const version = socket ? tmuxVersion(socket) : "";
  return tmuxPastesFlag(version) ? null : version || "unknown";
}

export const loopCommands: Record<string, Command> = {
  loop: () =>
    Effect.gen(function* () {
      const harness = opt.harness ?? "claude";
      if (!isLoopHarness(harness)) return yield* die(`${USAGE}: the loop doesn't start ${harness} yet`);
      for (const key of SESSION_MARKERS) if (!key.startsWith("KIWI_")) delete process.env[key];
      const recipe = recipeFor(harness);
      const unsupported = (): string | null =>
        opt.effort && !recipe.takesEffort
          ? `${recipe.label} keeps its effort per model in its own settings: drop --effort`
          : opt.model && !recipe.takesModel
            ? `${recipe.label} takes its model from its own settings (/model in a session): drop --model`
            : null;
      if (args[1] !== undefined) return yield* die(USAGE);
      if (recipe.screen && !typedPaneOk())
        return yield* die(`${recipe.label} takes its first prompt typed into its window, so kiwi loop --harness ${harness} runs only inside tmux, in the pane it was started from`);
      const oldTmux = recipe.screen ? typedTmuxOld() : null;
      if (oldTmux) return yield* die(`${recipe.label}'s first prompt needs tmux 3.7 or newer, to know when it can paste; this tmux is ${oldTmux}`);
      const why = unsupported();
      if (why) return yield* die(why);
      const bin = Bun.which(recipe.program, { PATH: process.env.PATH ?? "" }) ?? Bun.which(recipe.program, { PATH: yield* Effect.promise(() => loginPath()) });
      if (!bin) return yield* die(`${recipe.program} isn't on your login shell's PATH`);
      const { alias, name } = yield* seatNamed;
      const cfg = (yield* config).channels[alias];
      if (!cfg) return yield* die(`unknown channel "${alias}" (see: kiwi channels)`);
      yield* keepDaemon;
      const stop = { asked: false, busy: false };
      const asked = () => void (stop.asked = true);
      process.on("SIGINT", () => {
        process.stderr.write(`kiwi loop: debug: SIGINT busy=${stop.busy}\n`);
        if (!stop.busy) asked();
      });
      process.on("SIGTERM", asked);
      process.on("SIGHUP", asked);
      const token = process.env[SEAT_TOKEN] || newSeatToken();
      yield* runLoop({ alias, cfg, me: name, token, recipe: { ...recipe, bin }, ...(opt.model ? { model: opt.model } : {}), ...(opt.effort ? { effort: opt.effort } : {}) }, stop);
    }),
};
