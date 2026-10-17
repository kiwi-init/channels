import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { ChannelGone, goneText, reason, RelayError } from "../client.ts";
import { Keystore } from "../config.ts";
import { acting, Quit } from "./context.ts";

function stop(message: string, code = 1): never {
  process.stderr.write(`kiwi: ${message}\n`);
  process.exit(code);
}

export const fail = (cause: Cause.Cause<unknown>) =>
  Effect.gen(function* () {
    const err = Cause.squash(cause);
    if (err instanceof Quit) return stop(err.message, err.code);
    if (err instanceof ChannelGone) {
      const keys = yield* Keystore;
      if (acting.alias && err.why === "closed") yield* keys.wipeChannel(acting.alias);
      else if (acting.alias && acting.name) yield* keys.forgetMember(acting.alias, acting.name);
      return stop(goneText(err, acting.alias, acting.name), 4);
    }
    if (err instanceof RelayError) return stop(`relay: ${err.message}`);
    return stop(reason(err));
  });
