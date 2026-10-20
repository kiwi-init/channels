import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { Channel, type Relay } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import type { ChannelState, FoldBase, Roster } from "@kiwi/core/state.ts";
import { openSession, runAgent } from "../src/agent.ts";
import { Cache, Keystore, saveConfig, saveIdentity } from "../src/config.ts";
import { daemonSock, stopDaemon } from "../src/daemon.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const home = mkdtempSync(join(tmpdir(), "kiwi-trim-roster-"));
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-trim-roster-relay-"));
const prevHome = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;

let server: ReturnType<typeof startRelay> | undefined;
let dev: Identity;
let gentle: Identity;
let task = 0;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const relay = server.url.origin;
  const owner = await generateIdentity("human");
  dev = await generateIdentity("dev");
  gentle = await generateIdentity("gentle");
  const made = await Channel.create(relay, owner, { name: "human" }, [
    { ...dev, info: { name: "dev" } },
    { ...gentle, info: { name: "gentle" } },
  ]);
  const ownerCh = new Channel(made.access, relay, owner);
  const gentleCh = new Channel(await Channel.resume(relay, made.code, gentle), relay, gentle);
  task = await gentleCh.send("ship it", { kind: "event", ev: { op: "task.add", title: "ship it", owner: "gentle" } });
  await gentleCh.send("for review", { kind: "event", ev: { op: "task.update", task, state: "review", review: "*" } });
  await ownerCh.send("approved", { kind: "event", ev: { op: "task.update", task, state: "done", verdict: "approved", round: 1 } });
  saveConfig({ channels: { trim: { ...(await Channel.resume(relay, made.code, dev)), relay, code: made.code, as: "dev" } } });
  saveIdentity(dev, made.access.roomId);
});

afterAll(async () => {
  await stopDaemon(daemonSock(home)).catch(() => {});
  server?.stop(true);
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

type Folds = { roster: Roster | null; foldState(messages: Message[], roster: Roster): Effect.Effect<ChannelState, never, Relay | Cache> };

test("a trim folded under a short roster refolds with the whole roster before it saves a base (T1004)", async () => {
  const trims: FoldBase[] = [];
  const cache = {
    read: () => Effect.succeed([] as Message[]),
    append: () => Effect.void,
    base: () => Effect.succeed(null),
    keepBase: () => Effect.void,
    dropBase: () => Effect.void,
    trim: (_room: string, base: FoldBase) => Effect.sync(() => void trims.push(base)),
  };
  const state = await runAgent(
    Effect.gen(function* () {
      const cfg = (yield* (yield* Keystore).config).channels["trim"]!;
      const s = yield* openSession("trim", cfg, "dev");
      const rows = yield* s.ch.fx.memberRows();
      const folds = s as unknown as Folds;
      folds.roster = null;
      const short = yield* s.members(
        false,
        rows.filter((r) => r.pk !== gentle.pk),
      );
      expect(short.some((r) => r.name === "gentle")).toBe(false);
      const { messages, head } = yield* s.ch.fx.history(0);
      const now = Date.now();
      const filler = Array.from({ length: 900 }, (_, i): Message => ({
        v: 1,
        id: `filler-${i}`,
        from: "dev",
        kind: "msg",
        body: `filler ${i}`,
        ts: now,
        rts: now,
        seq: head + 1 + i,
        sigOk: true,
        pk: dev.pk,
      }));
      return yield* folds.foldState([...messages, ...filler], short);
    }).pipe(Effect.provideService(Cache, cache)),
  );
  expect(state.tasks.get(task)?.state).toBe("done");
  expect(trims).toHaveLength(1);
  const saved = trims[0]!.tasks.find((t) => t.id === task);
  expect(saved?.state).toBe("done");
  expect(saved?.rounds).toHaveLength(1);
  expect(trims[0]!.rejected.some(([, why]) => why.endsWith(" isn't a member"))).toBe(false);
});
