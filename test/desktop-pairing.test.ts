import { afterAll, expect, mock, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateIdentity } from "@kiwi/core/identity.ts";
import type { ComputerView } from "../desktop/src/bridge.ts";
import { loadPairedMachine, pairComputer } from "../src/daemon.ts";
import { loadMachine } from "../src/machine.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(30_000);

const home = mkdtempSync(join(tmpdir(), "kiwi-desktop-pairing-"));
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-desktop-pairing-relay-"));
const prevHome = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;
const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
const relay = server.url.origin;
const person = await generateIdentity("Ada Lovelace");
const added: ComputerView[] = [];
mock.module("../desktop/src/store.ts", () => ({
  store: { relayUrl: relay },
  requirePerson: () => person,
  upsertComputer: (c: ComputerView) => void added.push(c),
}));
const { pairAnswer, pairBegin, pairPoll } = await import("../desktop/src/pairing.ts");

const realFetch = globalThis.fetch;
let polledAnswer = () => {};
globalThis.fetch = Object.assign(
  async (input: string | URL | Request, init?: RequestInit) => {
    const res = await realFetch(input, init);
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/b") && (init?.method ?? "GET") === "GET") polledAnswer();
    return res;
  },
  { preconnect: realFetch.preconnect },
);
const computerPolls = () => new Promise<void>((resolve) => (polledAnswer = resolve));

afterAll(() => {
  globalThis.fetch = realFetch;
  server.stop(true);
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

test("the app's Pair leaves its answer in the mailbox until the computer has read it", async () => {
  const { code } = await pairBegin();
  const pairing = pairComputer(code, { relay, timeoutMs: 8_000, onStatus: () => {} });
  const ask = await pairPoll();
  expect(ask?.machinePk).toBe(loadMachine()?.identity.pk);
  await computerPolls();
  expect(await pairAnswer(true)).toEqual({ machinePk: ask!.machinePk });
  const { cert, person: paired } = await pairing;
  expect(loadPairedMachine()?.cert).toEqual(cert);
  expect(paired.pk).toBe(person.pk);
  expect(added.map((c) => c.machinePk)).toEqual([ask!.machinePk]);
});
