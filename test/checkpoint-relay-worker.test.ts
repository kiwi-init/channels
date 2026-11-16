import { Database } from "bun:sqlite";
import { afterAll, afterEach, describe, expect, mock, setDefaultTimeout, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel as Client } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { OPEN_POLICY } from "../src/relay/policy.ts";

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
  alarm(): Promise<void>;
}

class Socket {
  sent: string[] = [];
  constructor(private att: Record<string, unknown>) {}
  send(f: string): void {
    this.sent.push(f);
  }
  close(): void {}
  deserializeAttachment(): Record<string, unknown> {
    return this.att;
  }
  serializeAttachment(a: Record<string, unknown>): void {
    this.att = a;
  }
}

const daily = { at: "18:00", tz: "America/Sao_Paulo" };
const DUE = Date.parse("2026-11-16T21:00:00Z");
const DAY = 86_400_000;
const dir = mkdtempSync(join(tmpdir(), "kiwi-ckpt-worker-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => setSystemTime());

async function scheduledRoom(): Promise<{ roomId: string; pk: string; created: number }> {
  setSystemTime(DUE - 60_000);
  const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir, policy: { ...OPEN_POLICY, noRateLimits: true } });
  try {
    const owner = await generateIdentity("worker");
    const { access } = await Client.create(r.url.origin, owner, { name: "worker", kind: "human" }, []);
    await new Client(access, r.url.origin, owner).setCheckpointDaily(daily);
    return { roomId: access.roomId, pk: owner.pk, created: DUE - 60_000 };
  } finally {
    r.stop(true);
  }
}

async function workerOver(file: Database, sockets: () => Socket[]) {
  const alarms: number[] = [];
  const wiped: boolean[] = [];
  const ctx = {
    storage: {
      sql: { exec: (q: string, ...p: (string | number | null)[]) => ({ toArray: () => file.query(q).all(...p) }) },
      setAlarm: async (at: number) => void alarms.push(at),
      deleteAlarm: async () => {},
      deleteAll: async () => void wiped.push(true),
    },
    getWebSockets: sockets,
    setWebSocketAutoResponse: () => {},
    waitUntil: () => {},
  };
  const worker = "../src/relay/worker.ts";
  const { Channel } = (await import(worker)) as { Channel: new (ctx: unknown, env: Record<string, string>) => WorkerRoom };
  return { room: new Channel(ctx, { KIWI_EXPIRE_AFTER_DAYS: "1" }), alarms, wiped };
}

describe("on the worker, one alarm serves the checkpoint time and room expiry", () => {
  test("the checkpoint fires at its time, then the alarm goes to whichever deadline is next, and the idle room still expires on time", async () => {
    const { roomId, pk, created } = await scheduledRoom();
    const file = new Database(join(dir, `${roomId}.sqlite`));
    try {
      const socket = new Socket({ room: roomId, pk });
      let online = [socket];
      const { room, alarms, wiped } = await workerOver(file, () => online);

      setSystemTime(DUE + 1000);
      await room.alarm();
      expect(socket.sent.map((f) => JSON.parse(f) as unknown)).toEqual([{ t: "checkpoint", occurrence: "2026-11-16T18:00", due: DUE }]);
      expect(alarms.at(-1)).toBe(created + DAY);

      online = [];
      setSystemTime(created + DAY + 1000);
      await room.alarm();
      expect(wiped).toEqual([true]);
    } finally {
      file.close();
    }
  });

  test("while someone is connected, expiry moves out and the next checkpoint time keeps the alarm", async () => {
    const { roomId, pk, created } = await scheduledRoom();
    const file = new Database(join(dir, `${roomId}.sqlite`));
    try {
      const socket = new Socket({ room: roomId, pk });
      const { room, alarms, wiped } = await workerOver(file, () => [socket]);
      setSystemTime(created + DAY + 1000);
      await room.alarm();
      expect(wiped).toEqual([]);
      expect(socket.sent).toEqual([]);
      const tomorrow = DUE + DAY;
      expect(alarms.at(-1)).toBe(tomorrow);
      expect(tomorrow).toBeLessThan(created + DAY + 1000 + DAY);
    } finally {
      file.close();
    }
  });
});
