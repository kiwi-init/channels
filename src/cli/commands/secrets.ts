import * as Effect from "effect/Effect";
import { freshSecrets, runWithSecrets, shellFor } from "../../secrets.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out, session } from "../context.ts";

const NONE = "the owner hasn't given you any secrets in this channel; they add them in the Kiwi app";
const HOW =
  "kiwi secret run 'CMD' runs CMD with them in its environment, each under its name, and writes [secret NAME] wherever a value would show in its output. Never put a value in a message, a file or a commit: kiwi refuses to send one.";
const NEVER = "kiwi never prints a secret's value: kiwi secret run 'CMD' puts it in CMD's environment instead";
const USAGE = "usage: kiwi secret (the ones the owner gave you) · kiwi secret run 'CMD' · kiwi secret run -- CMD ARGS…";

const list: Command = () =>
  Effect.gen(function* () {
    const secrets = yield* freshSecrets(yield* session());
    if (opt.json) return out(JSON.stringify(secrets.map((s) => ({ name: s.name, note: s.note, at: s.at }))));
    if (!secrets.length) return out(NONE);
    const width = Math.max(...secrets.map((s) => s.name.length));
    for (const s of secrets) out(s.note ? `${s.name.padEnd(width)}  ${s.note}` : s.name);
    out(HOW);
  });

const run: Command = () =>
  Effect.gen(function* () {
    const rest = args.slice(2);
    if (!rest.length) return yield* die(USAGE);
    const split = process.argv.indexOf("--") > process.argv.indexOf("run");
    const cmd = rest.length === 1 && !split ? shellFor(rest[0]!) : rest;
    const secrets = yield* freshSecrets(yield* session());
    if (!secrets.length) return yield* die(NONE, 2);
    return yield* Effect.tryPromise({ try: () => runWithSecrets(cmd, secrets), catch: (err) => err }).pipe(
      Effect.catchIf(
        (err) => err instanceof Error && /ENOENT|not found/i.test(err.message),
        () => die(`${cmd[0]}: no such command`, 127),
      ),
    );
  });

export const secretCommands: Record<string, Command> = {
  secret: () => {
    const sub = args[1];
    if (sub === undefined || sub === "list") return list();
    if (sub === "run") return run();
    if (["get", "show", "print", "cat", "value", "reveal"].includes(sub)) return die(NEVER, 2);
    return die(USAGE);
  },
  secrets: () => list(),
};
