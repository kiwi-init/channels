import { afterAll, afterEach, describe, expect, setDefaultTimeout, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { CHECKPOINT_WINDOW_MS } from "@kiwi/core/checkpoint-schedule.ts";
import { startRelay } from "../src/relay/bun.ts";
import { OPEN_POLICY } from "../src/relay/policy.ts";

setDefaultTimeout(30_000);

const daily = { at: "18:00", tz: "America/Sao_Paulo" };
const DUE = Date.parse("2026-11-16T21:00:00Z");
const OCCURRENCE = "2026-11-16T18:00";
const policy = { ...OPEN_POLICY, noRateLimits: true };

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
afterEach(() => {
  setSystemTime();
});
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "kiwi-ckpt-relay-"));
  made.push(d);
  return d;
};

const ask = (ch: Channel, occurrence = OCCURRENCE) => ch.send("", { ev: { op: "checkpoint.ask", asks: [], unreachable: ["nobody"] }, occurrence });

async function room(r: ReturnType<typeof startRelay>, owner: Identity): Promise<Channel> {
  const { access } = await Channel.create(r.url.origin, owner, { name: "ckpt", kind: "human" }, []);
  return new Channel(access, r.url.origin, owner);
}

async function listen(ch: Channel): Promise<{ got: { occurrence: string; due: number }[]; stop: () => void }> {
  const got: { occurrence: string; due: number }[] = [];
  const ac = new AbortController();
  let ready = () => {};
  const opened = new Promise<void>((resolve) => (ready = resolve));
  void ch.stream(await ch.head(), () => {}, { signal: ac.signal, quietMs: 600_000, onReady: () => ready(), onCheckpoint: (o) => void got.push(o) }).catch(() => {});
  await opened;
  return { got, stop: () => ac.abort() };
}

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await Bun.sleep(20);
  expect(ok()).toBe(true);
};

describe("the relay keeps the daily clock and nothing else", () => {
  test("off by default; the owner's schedule is stored as the time and its zone, and the next occurrence follows it", async () => {
    const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: scratch(), policy });
    try {
      const ch = await room(r, await generateIdentity("owner"));
      expect(await ch.checkpoints()).toEqual({ daily: null, next: null, log: [] });
      setSystemTime(DUE - 60_000);
      await ch.setCheckpointDaily(daily);
      const view = await ch.checkpoints();
      expect(view).toEqual({ daily, next: { id: OCCURRENCE, due: DUE }, log: [] });
      expect(Object.keys(view).sort()).toEqual(["daily", "log", "next"]);
      expect(r.checkpointArmed(ch.roomId)).toBe(true);
      await ch.setCheckpointDaily(null);
      expect(r.checkpointArmed(ch.roomId)).toBe(false);
    } finally {
      r.stop(true);
    }
  });

  test("at the time, a connected client hears it; the first post for the occurrence is kept and the second refused", async () => {
    const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: scratch(), policy });
    const owner = await generateIdentity("owner");
    try {
      const ch = await room(r, owner);
      setSystemTime(DUE - 60_000);
      await ch.setCheckpointDaily(daily);
      const a = await listen(ch);
      const b = await listen(new Channel(ch.access, r.url.origin, owner));
      try {
        setSystemTime(DUE + 1000);
        r.fireCheckpoint(ch.roomId);
        await until(() => a.got.length === 1 && b.got.length === 1);
        expect(a.got[0]).toEqual({ occurrence: OCCURRENCE, due: DUE });
        const seq = await ask(ch);
        const second = await ask(new Channel(ch.access, r.url.origin, owner)).catch((e: unknown) => e);
        expect(String(second)).toContain("already made");
        const view = await ch.checkpoints();
        expect(view.log).toEqual([{ id: OCCURRENCE, due: DUE, state: "answered", seq }]);
        expect(view.next?.id).toBe("2026-11-17T18:00");
      } finally {
        a.stop();
        b.stop();
      }
    } finally {
      r.stop(true);
    }
  });

  test("with nobody online it's recorded as missed, nothing is asked later, and a late post is refused", async () => {
    const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: scratch(), policy });
    try {
      const ch = await room(r, await generateIdentity("owner"));
      setSystemTime(DUE - 60_000);
      await ch.setCheckpointDaily(daily);
      setSystemTime(DUE + 1000);
      r.fireCheckpoint(ch.roomId);
      expect((await ch.checkpoints()).log).toEqual([{ id: OCCURRENCE, due: DUE, state: "missed", why: "nobody online" }]);
      expect(String(await ask(ch).catch((e: unknown) => e))).toContain("already made, or isn't due");
    } finally {
      r.stop(true);
    }
  });

  test("an alarm that runs past the window records the time as missed and never fires it late", async () => {
    const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: scratch(), policy });
    try {
      const ch = await room(r, await generateIdentity("owner"));
      setSystemTime(DUE - 60_000);
      await ch.setCheckpointDaily(daily);
      const a = await listen(ch);
      try {
        setSystemTime(DUE + CHECKPOINT_WINDOW_MS + 1000);
        r.fireCheckpoint(ch.roomId);
        const view = await ch.checkpoints();
        expect(view.log).toEqual([{ id: OCCURRENCE, due: DUE, state: "missed", why: "relay asleep" }]);
        expect(view.next?.id).toBe("2026-11-17T18:00");
        expect(a.got).toEqual([]);
      } finally {
        a.stop();
      }
    } finally {
      r.stop(true);
    }
  });

  test("a client that reconnects inside the window is told again; one that nobody answered closes as missed", async () => {
    const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: scratch(), policy });
    const owner = await generateIdentity("owner");
    try {
      const ch = await room(r, owner);
      setSystemTime(DUE - 60_000);
      await ch.setCheckpointDaily(daily);
      const a = await listen(ch);
      setSystemTime(DUE + 1000);
      r.fireCheckpoint(ch.roomId);
      await until(() => a.got.length === 1);
      a.stop();
      const back = await listen(new Channel(ch.access, r.url.origin, owner));
      try {
        await until(() => back.got.length === 1);
        expect(back.got[0]?.occurrence).toBe(OCCURRENCE);
      } finally {
        back.stop();
      }
      setSystemTime(DUE + CHECKPOINT_WINDOW_MS);
      expect((await ch.checkpoints()).log).toEqual([{ id: OCCURRENCE, due: DUE, state: "missed", why: "nobody answered" }]);
    } finally {
      r.stop(true);
    }
  });

  test("a restarted relay arms the schedule again, and the occurrence fires once", async () => {
    const dir = scratch();
    const owner = await generateIdentity("owner");
    const first = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir, policy });
    let access;
    try {
      const ch = await room(first, owner);
      access = ch.access;
      setSystemTime(DUE - 60_000);
      await ch.setCheckpointDaily(daily);
    } finally {
      first.stop(true);
    }
    const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir, policy });
    try {
      const ch = new Channel(access, r.url.origin, owner);
      expect(r.checkpointArmed(ch.roomId)).toBe(true);
      const a = await listen(ch);
      try {
        setSystemTime(DUE + 1000);
        r.fireCheckpoint(ch.roomId);
        r.fireCheckpoint(ch.roomId);
        await until(() => a.got.length >= 1);
        await Bun.sleep(100);
        expect(a.got).toHaveLength(1);
        expect((await ch.checkpoints()).log.map((l) => l.id)).toEqual([OCCURRENCE]);
      } finally {
        a.stop();
      }
    } finally {
      r.stop(true);
    }
  });

  test("the idle sweep still expires a room that has a schedule", async () => {
    const dir = scratch();
    const expiring = { ...policy, expireAfterDays: 1 };
    const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir, policy: expiring });
    try {
      setSystemTime(DUE - 60_000);
      const ch = await room(r, await generateIdentity("owner"));
      await ch.setCheckpointDaily(daily);
      setSystemTime(DUE + 2 * 86_400_000);
      expect(r.sweep()).toBe(1);
      expect(r.checkpointArmed(ch.roomId)).toBe(false);
    } finally {
      r.stop(true);
    }
  });
});
