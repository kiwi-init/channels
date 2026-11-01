import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChannelIdentityView } from "../desktop/src/bridge.ts";
import { Keyring, type KeyHost } from "../desktop/src/keyring.ts";
import { bunSearchWorker } from "../desktop/src/search-host.ts";
import { acceptSeat, withAccess } from "../desktop/src/seats.ts";
import { foldRoster } from "@kiwi/channel/fold-roster.ts";
import { startRelay } from "../src/relay/bun.ts";
import { memoryBudget } from "./check.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-history-search-"));
const searchDir = join(dataDir, "search");
let server: ReturnType<typeof startRelay>;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(dataDir, "relay") });
});
afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

function keyring(): Keyring {
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
    search: () => ({ file: (name) => join(searchDir, name), spawn: () => bunSearchWorker(join(import.meta.dir, "../desktop/src/search-worker.ts")) }),
  };
  return new Keyring(host);
}

test("main indexes sealed archive rows in a worker, searches them by room, and leaving deletes the index (T977)", async () => {
  const k = keyring();
  const { code } = await k.create("archive", null, null);
  if (!code) throw new Error("no join code");
  for (let i = 1; i <= 30; i++) await k.call(code, "send", i % 10 === 0 ? `the quarterly REPORT-SENTINEL draft ${i}` : `ordinary chatter ${i}`);
  const head = (await k.call(code, "head")) as number;
  const { rows } = await k.olderRows(code, head + 1, 500);
  const roster = foldRoster(await k.call(code, "members"));
  const inputs = { roster, roomsFloor: null, guardFloor: null, now: Date.now() };

  expect(await k.indexRows(code, [], inputs)).toBe(0);
  const before = await k.searchHistory(code, { query: "report", rooms: ["general"], limit: 50, head });
  expect(before?.state).toBe("indexing");
  expect(await k.indexRows(code, rows, inputs)).toBe(head);

  const found = await k.searchHistory(code, { query: "report", rooms: ["general"], limit: 50, head });
  expect(found?.state).toBe("ready");
  expect(found?.hits.length).toBe(3);
  expect((await k.searchHistory(code, { query: "report", rooms: ["some-other-room"], limit: 50, head }))?.hits).toEqual([]);

  const files = readdirSync(searchDir);
  expect(files.length).toBe(1);
  expect(readFileSync(join(searchDir, files[0]!)).includes(Buffer.from("REPORT-SENTINEL"))).toBe(false);

  await k.forget(code);
  expect(existsSync(join(searchDir, files[0]!))).toBe(false);
});
