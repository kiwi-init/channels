import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

import * as Effect from "effect/Effect";

import { Channel, eachLive } from "@kiwi/core/client.ts";
import { newRoomId } from "@kiwi/core/crypto.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { handleFor } from "@kiwi/core/membership.ts";
import { personaOf } from "@kiwi/core/personality.ts";
import { PRESETS } from "@kiwi/core/presets.ts";
import type { Activity } from "@kiwi/core/protocol.ts";

import type { ChannelIdentityView } from "../../desktop/src/bridge.ts";
import type { AgentSession } from "../../src/agent.ts";
import type { Saved } from "../engine/wire.ts";

const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1]! : fallback;
};

const lanAddress = (): string => {
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal && a.address.startsWith("192.168.")) return a.address;
  return "127.0.0.1";
};

const root = arg("dir", join(process.cwd(), ".ios-dev"));
const port = Number(arg("port", "8790"));
const personName = arg("name", "Jonatas Walker");
const out = arg("saved-file", join(root, "phone.json"));

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
process.env.KIWI_HOME = join(root, "home");
process.env.KIWI_NO_HOOKS = "1";

const { startRelay } = await import("../../src/relay/bun.ts");
const { openSession, runAgent } = await import("../../src/agent.ts");
const { openOwnerSession } = await import("../../src/owner.ts");
const { loadIdentity, saveConfig } = await import("../../src/config.ts");

const server = startRelay({ port, hostname: "0.0.0.0", dataDir: join(root, "relay") });
const local = `http://127.0.0.1:${port}`;
const relay = `http://${arg("host", lanAddress())}:${port}`;
const say = (line: string) => process.stdout.write(`${line}\n`);

const person = await generateIdentity(personName);
const { xpk: personXpk, xsk: personXsk } = person;
if (!personXpk || !personXsk) throw new Error("the person key has no exchange key");
const handle = handleFor(personName);
const title = arg("title", "onemouse");

const program = Effect.gen(function* () {
  const roomId = newRoomId();
  const owner = yield* Effect.promise(() => loadIdentity(handle, roomId));
  const names = ["lead", "mac", "win", "ci"] as const;
  const ids = yield* Effect.promise(() => Promise.all(names.map((n) => loadIdentity(n, roomId))));
  const { code, access } = yield* Channel.fx.create(
    local,
    owner,
    { name: handle, role: "owner", kind: "human", display: personName },
    ids.map((id) => ({ ...id, info: { name: id.name } })),
    roomId,
    null,
    title,
  );
  const cfg = { ...access, relay: local, code, owner: handle };
  saveConfig({ default: "dev", channels: { dev: cfg } });
  const human = yield* openOwnerSession("dev", cfg, handle);
  const [lead, mac, win, ci] = yield* Effect.all([openSession("dev", cfg, "lead"), openSession("dev", cfg, "mac"), openSession("dev", cfg, "win"), openSession("dev", cfg, "ci")], {
    concurrency: "unbounded",
  });

  yield* human.setCharter("Get onemouse working end to end between a Mac and a PC. This repo only; nothing in production; ask before adding dependencies.");
  yield* mac.refreshCard({ os: "macos", arch: "arm64", harness: "claude-code", tools: ["git", "rust", "xcode"], repo: "ojow/onemouse" });
  yield* win.refreshCard({ os: "windows", arch: "x64", harness: "codex", tools: ["git", "rust", "dotnet"], repo: "ojow/onemouse" });
  yield* ci.refreshCard({ os: "linux", arch: "x64", tools: ["git", "docker", "rust"], note: "the CI box" });
  yield* lead.hello();
  yield* human.givePersona("lead", personaOf(PRESETS.find((p) => p.role === "lead")!));
  const proto = yield* lead.taskAdd("Freeze protocol v1 wire format", { review: "any" });
  const inject = yield* lead.taskAdd("Inject mouse input on Windows");
  const capture = yield* lead.taskAdd("Capture input at the screen edge on the Mac");
  yield* lead.taskAdd("Build the release in CI");
  yield* lead.send("Board is up: four tasks. mac takes the protocol, win the injection, and I'll keep CI honest.", {});
  yield* mac.taskClaim(proto);
  const q = yield* win.ask("Do you forward key repeat? Windows doesn't repeat injected keys.", { to: ["mac"] });
  yield* mac.reply(q.seq, "Yes: autorepeat goes out as extra KeyDown events.");
  yield* mac.taskUpdate(proto, { state: "review", note: "spec in docs/protocol-v1.md" });
  yield* ci.taskUpdate(proto, { state: "done", note: "round-trips every message; approved" });
  yield* win.taskClaim(inject);
  yield* mac.taskClaim(capture);
  yield* mac.send("Edge capture works on one monitor. Multi-monitor next: macOS reports the second screen's origin negative, so the mapping flips.", {});
  yield* win.send("Injection is in: SendInput with MOUSEEVENTF_ABSOLUTE, scaled to 0..65535. Testing on a 4K screen now.", {});
  yield* lead.send(
    [
      "## Where the release stands",
      "1. Protocol v1: **done**",
      "2. Injection: in review",
      "3. Edge capture: _multi-monitor next_",
      "",
      "- [x] Signed with the team certificate",
      "- [ ] Notarized",
      "",
      "> macOS reports the second screen's origin negative.",
      "",
      "| Job | State |",
      "| --- | --- |",
      "| mac | green |",
      "| win | `running` |",
      "",
      "```",
      "kiwi task done T3",
      "```",
      "Notes in https://example.com/release",
    ].join("\n"),
    {},
  );
  yield* lead.escalate("win is about to ship the installer: sign it with the team certificate now, or ship the beta unsigned?", undefined, undefined, {
    choices: ["A: Sign it now with the team certificate", "B: Ship unsigned for the beta, sign at 1.0"],
    decision: "choice",
    holds: [inject],
  });

  const beacon = (agent: AgentSession, activity: () => Activity) =>
    eachLive(
      agent.ch.fx.live(head, { presence: false, reads: false }),
      (ev) => (ev._tag === "Open" ? Effect.forever(Effect.andThen(ev.presence({ client: "tail", reach: "listening", activity: activity() }), Effect.sleep(20_000))) : Effect.void),
      () => Effect.void,
    ).pipe(Effect.ignoreCause);
  const head = yield* human.ch.fx.head();
  const since = Date.now();
  yield* Effect.forkChild(beacon(mac, () => ({ state: "working", tool: "Bash", since })));
  yield* Effect.forkChild(beacon(win, () => ({ state: "working", tool: "Edit", since })));
  yield* Effect.forkChild(beacon(lead, () => ({ state: "idle" })));

  const seat: ChannelIdentityView = { label: title, idName: handle, pk: owner.pk, sk: owner.sk, xpk: owner.xpk, xsk: owner.xsk, roomId, code, access, at: Date.now(), name: title };
  const saved: Saved = { relay, person: { name: person.name, pk: person.pk, sk: person.sk, xpk: personXpk, xsk: personXsk }, seats: [seat] };
  writeFileSync(out, JSON.stringify(saved));
  say(`relay ${relay}`);
  say(`a phone's saved keys for this channel are in ${out}`);

  const answers = ["On it.", "Good call, doing that now.", "Noted. I'll post when it's in review.", "Makes sense: I'll tell win."];
  let turn = 0;
  yield* eachLive(
    human.ch.fx.live(head, { presence: false, reads: false }),
    (ev) =>
      ev._tag === "Message" && ev.message.from === handle && ev.message.kind !== "event"
        ? Effect.gen(function* () {
            say(`${handle}: ${ev.message.body}`);
            yield* Effect.sleep(1_200);
            yield* lead.reply(ev.message.seq, answers[turn++ % answers.length]!);
          }).pipe(Effect.ignoreCause)
        : Effect.void,
    () => Effect.void,
  );
});

process.once("SIGINT", () => {
  server.stop(true);
  process.exit(0);
});

await runAgent(Effect.scoped(program));
