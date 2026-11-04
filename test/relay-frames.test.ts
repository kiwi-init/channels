import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, mock, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Layer from "effect/Layer";
import { Channel as Client } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import type { ServerFrame } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { GithubApp, GithubPush, githubPushFrom } from "../src/relay/github-app.ts";
import { Human } from "../src/relay/human.ts";
import { OPEN_POLICY, Policy } from "../src/relay/policy.ts";
import { Directory, onClientFrame, RoomDb, type Sql } from "../src/relay/room.ts";
import { makeRelay, runRoomSync } from "../src/relay/route.ts";

setDefaultTimeout(30_000);

class DurableObjectStandIn {
  constructor(
    public ctx: unknown,
    public env: unknown,
  ) {}
}
mock.module("cloudflare:workers", () => ({ DurableObject: DurableObjectStandIn }));
Object.assign(globalThis, { WebSocketRequestResponsePair: class {} });

interface WorkerRoom {
  webSocketMessage(ws: unknown, data: string): Promise<void>;
}

const TH = "thread-aaaaaaaaaaaaaaa";
const sqlOf = (db: Database): Sql => ({
  run: (q, ...p) => void db.query(q).run(...p),
  all: <T>(q: string, ...p: (string | number | null)[]) => db.query(q).all(...p) as T[],
});
const relayCtx = makeRelay(
  Layer.mergeAll(
    Layer.succeed(Human, null),
    Layer.succeed(GithubApp, null),
    Layer.succeed(GithubPush, githubPushFrom()),
    Layer.succeed(Policy, { ...OPEN_POLICY, noRateLimits: true }),
    Layer.succeed(Directory, { list: async () => [], reserve: async () => true, release: async () => {} }),
  ),
);

class Socket {
  sent: string[] = [];
  constructor(
    private att: Record<string, unknown>,
    private closing = false,
  ) {}
  send(f: string): void {
    if (this.closing) throw new Error("Can't call WebSocket send() after close().");
    this.sent.push(f);
  }
  deserializeAttachment(): Record<string, unknown> {
    return this.att;
  }
  serializeAttachment(a: Record<string, unknown>): void {
    this.att = a;
  }
}

describe("the relay answers every frame and relays what it stored (T1429)", () => {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-relay-frames-"));
  let server: ReturnType<typeof startRelay>;
  let owner: Identity;
  let roomId = "";

  beforeAll(async () => {
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir });
    owner = await generateIdentity("frames");
    roomId = (await Client.create(server.url.origin, owner, { name: "frames", kind: "human" }, [])).access.roomId;
  });
  afterAll(() => {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("a frame that isn't a JSON object gets bad json back instead of throwing", () => {
    const file = new Database(join(dir, `${roomId}.sqlite`));
    try {
      for (const raw of ["null", "[]", "3", '"doc"', "{"]) {
        const fx = runRoomSync(relayCtx, new RoomDb(sqlOf(file), roomId), onClientFrame(raw, owner.pk));
        expect(JSON.parse(String(fx.reply)) as ServerFrame).toEqual({ t: "err", error: "bad json" });
      }
    } finally {
      file.close();
    }
  });

  test("on the worker, a sender whose socket is closing doesn't keep its stored update from the doc's followers", async () => {
    const file = new Database(join(dir, `${roomId}.sqlite`));
    const sender = new Socket({ room: roomId, pk: owner.pk, docs: [] }, true);
    const follower = new Socket({ room: roomId, pk: owner.pk, docs: [TH] });
    const ctx = {
      storage: {
        sql: { exec: (q: string, ...p: (string | number | null)[]) => ({ toArray: () => file.query(q).all(...p) }) },
        setAlarm: async () => {},
      },
      getWebSockets: () => [sender, follower],
      setWebSocketAutoResponse: () => {},
      waitUntil: () => {},
    };
    const worker = "../src/relay/worker.ts";
    const { Channel } = (await import(worker)) as { Channel: new (ctx: unknown, env: Record<string, string>) => WorkerRoom };
    try {
      await new Channel(ctx, {}).webSocketMessage(sender, JSON.stringify({ t: "doc", id: "d1", th: TH, iv: "aXZpdml2aXZpdml2", ct: "dXBkYXRl", e: 0 }));
      expect(follower.sent.map((f) => JSON.parse(f) as ServerFrame)).toEqual([expect.objectContaining({ t: "doc", th: TH, dseq: 1 })]);
    } finally {
      file.close();
    }
  });
});
