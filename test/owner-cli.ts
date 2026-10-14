// Test helper: the owner's side, played in-process through the client library (what the Kiwi app
// does), as a command line so CLI tests can drive it beside `kiwi`. Not shipped: the kiwi command is
// for agents. `bun test/owner-cli.ts <verb> ...` with KIWI_HOME/KIWI_RELAY set like kiwi's.
//
//   create [ALIAS] --as AGENT [--role R] [--about A] [--open]   a channel, owned by "human", AGENT in it
//   requests | approve CODE [--name N] [--role R] | deny CODE|KEY | kick NAME | close
//   role NAME ROLE|none [--about A] | room create NAME | room rename NAME|ID NEWNAME
import * as Effect from "effect/Effect";
import { runAgent } from "../src/agent.ts";
import { Channel } from "../src/client.ts";
import { Cursor, DEFAULT_RELAY, Keystore } from "../src/config.ts";
import { newRoomId } from "../src/crypto.ts";
import { bindDirectory } from "../src/hooks.ts";
import { fingerprint } from "../src/identity.ts";
import { openOwnerSession } from "../src/owner.ts";
import { baseName, here } from "../src/seats.ts";
import { join } from "node:path";
import { COORDINATOR } from "../src/state.ts";

const OWNER = "human";
const argv = process.argv.slice(2);
const opt: Record<string, string | true> = {};
const args: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === "--open" || a === "--yes") opt[a.slice(2)] = true;
  else if (a.startsWith("--") || a === "-c") opt[a.replace(/^-+/, "")] = argv[++i]!;
  else args.push(a);
}
const str = (k: string) => (typeof opt[k] === "string" ? (opt[k] as string) : undefined);
const out = (l: string) => process.stdout.write(l + "\n");
class Die {
  constructor(readonly message: string) {}
}
const die = (m: string) => Effect.fail(new Die(m));

const owner = Effect.gen(function* () {
  const keys = yield* Keystore;
  const cfg = yield* keys.config;
  const alias = str("c") ?? (cfg.default && cfg.channels[cfg.default] ? cfg.default : Object.keys(cfg.channels).find((a) => cfg.channels[a]!.owner === OWNER));
  if (!alias) return yield* die("no channel owned here");
  return yield* openOwnerSession(alias, cfg.channels[alias]!, OWNER);
});

const findRequest = Effect.fn(function* (needle: string, byKey = false) {
  const s = yield* owner;
  const reqs = yield* s.requests();
  if (byKey && needle.replace(/\D/g, "").length !== 6) {
    const m = reqs.filter((x) => fingerprint(x.pk).startsWith(needle));
    return m.length === 1 ? { s, r: m[0]! } : yield* die(`no single request with key ${needle}`);
  }
  const digits = needle.replace(/\D/g, "");
  const r = reqs.find((x) => x.code?.replace("-", "") === digits);
  return r ? { s, r } : yield* die(`no pending request shows code ${needle}`);
});

const verbs: Record<string, () => Effect.Effect<void, unknown, any>> = {
  quick: () => verbs.create!(),
  create: () =>
    Effect.gen(function* () {
      const keys = yield* Keystore;
      const name = str("as") ?? process.env.KIWI_AS ?? baseName(here());
      const relay = (process.env.KIWI_RELAY ?? DEFAULT_RELAY).replace(/\/+$/, "");
      const roomId = newRoomId();
      const [o, agent] = yield* Effect.all([keys.identity(OWNER, roomId), keys.identity(name, roomId)]);
      const role = str("role");
      const about = str("about");
      const { code, access } = yield* Channel.fx.create(relay, o, { name: OWNER, role: "owner" }, [{ ...agent, info: { name, ...(role ? { role } : {}), ...(about ? { about } : {}) } }], roomId, null, args[1]);
      const alias = args[1] ?? "channel";
      const cfg = yield* keys.update((c) => {
        c.channels[alias] = { ...access, relay, code, as: name, owner: OWNER };
        c.default ??= alias;
      });
      const ownerCh = new Channel(access, relay, o);
      if (!opt.open) {
        yield* ownerCh.fx.startCoordinated();
        if (!role) yield* ownerCh.fx.send(`made ${name} ${COORDINATOR}`, { kind: "event", ev: { op: "role.set", member: name, role: COORDINATOR }, to: [name] });
      }
      yield* (yield* Cursor).write(alias, name, yield* ownerCh.fx.head());
      const { openSession } = yield* Effect.promise(() => import("../src/agent.ts"));
      const s = yield* openSession(alias, cfg.channels[alias]!, name);
      yield* s.hello(role, about);
      const who = here();
      bindDirectory(process.cwd(), { alias, as: name, ...(who.harness ? { harness: who.harness } : { plain: true as const }) });
      out(`join code: ${code}`);
      // The agent's brief, as kiwi gives it (the agent's own command, not this one).
      const brief = Bun.spawnSync([process.execPath, join(import.meta.dir, "../src/cli/main.ts"), "prompt", "-c", alias, "--as", name], { stdout: "pipe", stderr: "inherit" });
      out("");
      process.stdout.write(brief.stdout.toString());
    }),
  requests: () =>
    Effect.gen(function* () {
      const s = yield* owner;
      const reqs = yield* s.requests();
      if (!reqs.length) return out("no pending join requests");
      for (const r of reqs) {
        const asked = r.askedAs && r.askedAs !== r.name ? ` (asked as ${r.askedAs}, which is taken)` : "";
        out(`${(r.code ?? (r.check === "waiting" ? "waiting" : "unchecked")).padEnd(8)} ${r.name}${asked}${r.role ? ` (${r.role})` : ""} · key ${fingerprint(r.pk)}`);
      }
    }),
  approve: () =>
    Effect.gen(function* () {
      const { s, r } = yield* findRequest(args[1] ?? (yield* die("usage: approve CODE")));
      const askedCoordinator = r.role?.trim().toLowerCase() === COORDINATOR && str("role")?.trim().toLowerCase() !== COORDINATOR;
      const role = str("role") ?? (askedCoordinator ? undefined : r.role);
      const admitted = yield* s.ownerCh.fx.approve(r, { name: str("name") ?? r.name, role, about: r.about });
      out(`approved ${admitted.name} (${r.code})`);
      const coordinator = yield* s.ensureCoordinator().pipe(Effect.catchCause(() => Effect.succeed(null)));
      if (coordinator) out(`${coordinator} is the coordinator`);
    }),
  deny: () =>
    Effect.gen(function* () {
      const { s, r } = yield* findRequest(args[1] ?? (yield* die("usage: deny CODE|KEY")), true);
      yield* s.ownerCh.fx.deny(r.id);
      out(`denied ${r.name}`);
    }),
  kick: () =>
    Effect.gen(function* () {
      const s = yield* owner;
      const name = args[1] ?? (yield* die("usage: kick NAME"));
      const m = (yield* s.members(true)).find((x) => x.name === name && x.active) ?? (yield* die(`"${name}" isn't a member`));
      const { state } = yield* s.state();
      yield* s.ownerCh.fx.remove(m.pk);
      out(`removed ${name}; rotated the channel key so they can't read anything new`);
      if (state.coordinator === name && state.mode.coordinatorOnly) {
        const next = yield* s.ensureCoordinator().pipe(Effect.catchCause(() => Effect.succeed(null)));
        out(next ? `${next} is the coordinator now` : "nobody coordinates now");
      }
    }),
  close: () =>
    Effect.gen(function* () {
      if (!opt.yes) return yield* die("closing needs your human's go-ahead; re-run with --yes once they confirm");
      const s = yield* owner;
      yield* s.ownerCh.fx.close();
      yield* (yield* Keystore).wipeChannel(s.alias);
      out(`closed "${s.alias}"`);
    }),
  role: () =>
    Effect.gen(function* () {
      const s = yield* owner;
      const [member, role] = args.slice(1);
      if (!member || !role) return yield* die("usage: role NAME ROLE|none");
      const clear = role.toLowerCase() === "none";
      const { state } = yield* s.state();
      const becomes = !clear && role.trim().toLowerCase() === COORDINATOR;
      if (state.coordinator === member && !becomes && state.mode.coordinatorOnly) yield* s.setMode(false);
      yield* s.decideRole(member, { role: clear ? null : role, ...(str("about") !== undefined ? { about: str("about") } : {}) });
      out(clear ? `cleared ${member}'s role` : `made ${member} ${role}`);
      if (becomes && !state.mode.coordinatorOnly) yield* s.setMode(true);
    }),
  room: () =>
    Effect.gen(function* () {
      const s = yield* owner;
      const [sub, a, b] = args.slice(1);
      if (sub === "create" && a) {
        const { id, state } = yield* s.createRoom(a);
        return out(`made #${state.rooms.get(id)?.name ?? a} (id ${id})`);
      }
      if (sub === "rename" && a && b) {
        yield* s.renameRoom(a, b);
        return out(`renamed #${a} to #${b}`);
      }
      return yield* die("usage: room create NAME | room rename NAME|ID NEWNAME");
    }),
};

const verb = verbs[args[0] ?? ""];
if (!verb) {
  process.stderr.write(`owner-cli: no verb ${args[0]}\n`);
  process.exit(2);
}
try {
  await runAgent(verb() as Effect.Effect<void, unknown, never>);
  process.exit(0);
} catch (e) {
  process.stderr.write(`owner-cli: ${e instanceof Die ? e.message : e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
