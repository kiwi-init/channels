import * as Effect from "effect/Effect";
import { PLACE_NAMES, readPlacedSeat } from "@kiwi/core/terminals.ts";
import { seatPlaces, showSeat } from "../../terminals/registry.ts";
import { parseJson } from "../../terminals/shared/json.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out } from "../context.ts";

const USAGE = "usage: kiwi terminal seats [--json] | kiwi terminal show --seat SEAT";

export const terminalCommands: Record<string, Command> = {
  terminal: () =>
    Effect.gen(function* () {
      const sub = args[1];
      if (sub === "seats") {
        const seats = yield* Effect.promise(() => seatPlaces());
        return out(opt.json ? JSON.stringify(seats) : seats.map((s) => `${s.alias} ${s.agent} ${PLACE_NAMES[s.place]}`).join("\n"));
      }
      if (sub === "show") {
        const seat = readPlacedSeat(parseJson(opt.seat ?? ""));
        if (!seat) return yield* die("usage: kiwi terminal show --seat SEAT, with SEAT one of kiwi terminal seats --json");
        return out(JSON.stringify(yield* Effect.promise(() => showSeat(seat))));
      }
      return yield* die(USAGE);
    }),
};
