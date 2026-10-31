import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRows } from "@kiwi/core/cache-row.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import type { ChannelIdentityView } from "../desktop/src/bridge.ts";
import { Keyring, type KeyHost } from "../desktop/src/keyring.ts";
import { acceptSeat, channelAccess, withAccess } from "../desktop/src/seats.ts";
import { startRelay } from "../src/relay/bun.ts";
import { memoryBudget } from "./check.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-older-rows-"));
let server: ReturnType<typeof startRelay>;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
});
afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

function memHost(): { host: KeyHost; seats: () => ChannelIdentityView[] } {
  let seats: ChannelIdentityView[] = [];
  const host: KeyHost = {
    relay: () => server.url.origin,
    seats: () => seats,
    save: async (entry) => void (seats = acceptSeat(seats, entry)),
    access: async (code, pk, access) => void (seats = withAccess(seats, code, pk, access)),
    forget: async (code) => void (seats = seats.filter((c) => c.code !== code)),
    prove: async () => null,
    githubToken: async () => null,
    person: () => null,
    mine: () => null,
    budget: memoryBudget(),
  };
  return { host, seats: () => seats };
}

test("older rows come from the relay sealed like cached ones, a page at a time, and say when the start is reached (T977)", async () => {
  const { host, seats } = memHost();
  const keyring = new Keyring(host);
  const { code } = await keyring.create("archive", null, null);
  const said: number[] = [];
  for (let i = 1; i <= 12; i++) said.push((await keyring.call(code, "send", `secret line ${i}`)) as number);
  const head = Math.max(...said);
  const access = channelAccess(seats().find((s) => s.code === code)!)!;

  const first = await keyring.olderRows(code, head - 1, 5);
  expect(first.rows.map((r) => r.seq)).toEqual([head - 6, head - 5, head - 4, head - 3, head - 2]);
  expect(first.done).toBe(false);
  expect(JSON.stringify(first.rows)).not.toContain("secret line");
  const opened = (await openRows(first.rows, access.roomId, access.keys)).filter((m): m is Message => !!m && "body" in m);
  expect(opened.map((m) => m.body)).toEqual(said.slice(-7, -2).map((_, i) => `secret line ${i + 6}`));

  const rest = await keyring.olderRows(code, head - 6, 500);
  expect(rest.rows[0]!.seq).toBe(1);
  expect(rest.done).toBe(true);
  expect(await keyring.olderRows(code, 1, 500)).toEqual({ rows: [], done: true });
});
