import * as Effect from "effect/Effect";
import { home } from "../../config/paths.ts";
import { fetched, listSkills, skillHome, skillText } from "../../skills.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out, Quit } from "../context.ts";

const run = <T>(f: () => T) => Effect.try({ try: f, catch: (e) => new Quit({ message: e instanceof Error ? e.message : String(e), code: 1 }) });

export const skillCommands: Record<string, Command> = {
  skill: () =>
    Effect.gen(function* () {
      if (args[2]) return yield* die("usage: kiwi skill [name]");
      const at = home();
      const skills = yield* run(() => listSkills(at));
      const name = args[1];
      if (!name) {
        if (opt.json) return out(JSON.stringify(skills.map((s) => ({ ...s, fetched: fetched(at, s) }))));
        for (const s of skills) {
          const from = s.source ? `${s.source} @ ${s.ref!.slice(0, 7)}` : `in the ${s.mod} mod`;
          out(`${s.name}: ${s.about}`);
          out(`  ${from}${fetched(at, s) ? "" : ", fetched on first use"}`);
        }
        return out("kiwi skill NAME prints one, with the paths to its files");
      }
      const skill = skills.find((s) => s.name === name) ?? (yield* die(`no skill named ${name}: kiwi skill lists them`));
      const dir = yield* run(() => skillHome(at, skill));
      out(yield* run(() => skillText(skill, dir)));
    }),
};
