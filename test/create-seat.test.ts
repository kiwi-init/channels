import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChannelIdentityView } from "../desktop/src/bridge.ts";
import { Keyring, type KeyHost } from "../desktop/src/keyring.ts";
import { acceptSeat, withAccess } from "../desktop/src/seats.ts";
import { startRelay } from "../src/relay/bun.ts";
import { memoryBudget } from "./check.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "mc-create-"));
let server: ReturnType<typeof startRelay>;
let relay: string;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});
afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

function memHost(opts: { relay?: () => string; failSaveWithAccess?: boolean } = {}): { host: KeyHost; store: { seats: ChannelIdentityView[]; saves: ChannelIdentityView[] } } {
  const store = { seats: [] as ChannelIdentityView[], saves: [] as ChannelIdentityView[] };
  const host: KeyHost = {
    relay: opts.relay ?? (() => relay),
    seats: () => store.seats,
    save: async (entry) => {
      store.saves.push(entry);
      if (opts.failSaveWithAccess && entry.access) throw new Error("the disk is full");
      store.seats = acceptSeat(store.seats, entry);
    },
    access: async (code, pk, access) => void (store.seats = withAccess(store.seats, code, pk, access)),
    forget: async (code) => void (store.seats = store.seats.filter((c) => c.code !== code)),
    prove: async () => null,
    githubToken: async () => null,
    person: () => null,
    budget: memoryBudget(),
  };
  return { host, store };
}

test("the owner key is saved before the relay hears of the channel", async () => {
  const { host, store } = memHost();
  const made = await new Keyring(host).create("plans", null, null);
  expect(store.saves.map((s) => ({ creating: s.creating === true, access: !!s.access, code: s.code === made.code }))).toEqual([
    { creating: true, access: false, code: true },
    { creating: false, access: true, code: true },
  ]);
  expect(store.seats).toHaveLength(1);
  expect(store.seats[0]!.creating).toBeUndefined();
});

test("a save that fails after the relay made the channel leaves the owner key, and the next start finishes the seat", async () => {
  const failing = memHost({ failSaveWithAccess: true });
  await expect(new Keyring(failing.host).create("plans", null, null)).rejects.toThrow("the disk is full");
  expect(failing.store.seats).toHaveLength(1);
  expect(failing.store.seats[0]!.creating).toBe(true);

  const { host, store } = memHost();
  store.seats = failing.store.seats;
  const again = new Keyring(host);
  await again.finishCreating();
  expect(store.seats).toHaveLength(1);
  expect(store.seats[0]!.creating).toBeUndefined();
  expect(store.seats[0]!.access).toBeTruthy();
  const members = await again.call(store.seats[0]!.code!, "members");
  expect(members.find((m) => m.owner)?.pk).toBe(store.seats[0]!.pk);
});

test("a create that never reached the relay is forgotten on the next start, once the relay says it has no such channel", async () => {
  const offline = memHost({ relay: () => "http://127.0.0.1:9" });
  await expect(new Keyring(offline.host).create("plans", null, null)).rejects.toThrow();
  expect(offline.store.seats.map((s) => s.creating)).toEqual([true]);

  const { host, store } = memHost();
  store.seats = offline.store.seats;
  await new Keyring(host).finishCreating();
  expect(store.seats).toEqual([]);
});
