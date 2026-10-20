import { Database } from "bun:sqlite";
import { afterAll, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { OPEN_POLICY } from "../src/relay/policy.ts";

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "kiwi-bun-store-"));
  made.push(d);
  return d;
};

test("a message on the Bun relay runs its two writes and one check that nothing else changed the file: the room's store stays warm between requests", async () => {
  const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: scratch() });
  try {
    const owner = await generateIdentity("store");
    const ch = new Channel((await Channel.create(r.url.origin, owner, { name: "store", kind: "human" }, [])).access, r.url.origin, owner);
    await ch.send("warm up");
    const queries = spyOn(Database.prototype, "query");
    try {
      for (let i = 0; i < 10; i++) await ch.send(`message ${i}`);
      expect(queries.mock.calls.length / 10).toBeLessThanOrEqual(3);
    } finally {
      queries.mockRestore();
    }
  } finally {
    r.stop(true);
  }
});

test("a change another connection commits to a room's file is read, not the warm copy", async () => {
  const dir = scratch();
  const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir });
  try {
    const owner = await generateIdentity("outside");
    const { access } = await Channel.create(r.url.origin, owner, { name: "outside", kind: "human" }, []);
    const ch = new Channel(access, r.url.origin, owner);
    expect(await ch.send("one")).toBe(1);
    const file = new Database(join(dir, `${access.roomId}.sqlite`));
    try {
      file.query("INSERT INTO msgs (seq, ts, iv, ct, e) SELECT seq + 1, ts, iv, ct, e FROM msgs WHERE seq = 1").run();
    } finally {
      file.close();
    }
    expect(await ch.send("three")).toBe(3);
  } finally {
    r.stop(true);
  }
});

test("the idle sweep closes the rooms it opened only to check them, and keeps the ones in use", async () => {
  const dir = scratch();
  const policy = { ...OPEN_POLICY, expireAfterDays: 90 };
  const first = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir, policy });
  const owner = await generateIdentity("sweep");
  const rooms = [];
  try {
    for (const name of ["a", "b", "c"]) rooms.push((await Channel.create(first.url.origin, owner, { name, kind: "human" }, [])).access);
  } finally {
    first.stop(true);
  }
  const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir, policy });
  try {
    await new Channel(rooms[0]!, r.url.origin, owner).send("in use");
    const closes = spyOn(Database.prototype, "close");
    try {
      expect(r.sweep()).toBe(0);
      expect(closes.mock.calls.length).toBe(2);
      closes.mockClear();
      expect(r.sweep()).toBe(0);
      expect(closes.mock.calls.length).toBe(2);
    } finally {
      closes.mockRestore();
    }
    expect(await new Channel(rooms[1]!, r.url.origin, owner).send("still here")).toBeGreaterThan(0);
  } finally {
    r.stop(true);
  }
});
