import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { b64url } from "@kiwi/core/crypto.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { certifyMachine } from "@kiwi/core/person.ts";
import { newShellKey, openPipe, type Pipe } from "@kiwi/core/pipe.ts";
import { WS_PROTOCOL } from "@kiwi/core/protocol.ts";
import type { TermSend } from "../src/daemon/hosted-term.ts";
import { remoteShells, REMOTE_SHELLS, SHELL_OPENS_PER_MINUTE, type ShellDeps, type ShellResult } from "../src/daemon/shells.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-remote-shells-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
let person: Identity;
let machine: Identity;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
  person = await withExchangeKey(await generateIdentity("person"));
  machine = await withExchangeKey(await generateIdentity("vps"));
  const cert = await certifyMachine(person, { pk: machine.pk, xpk: machine.xpk!, label: "vps" });
  const path = `/v1/machine/${machine.pk}`;
  const body = JSON.stringify({ cert });
  const token = await signRequest(machine, `machine:${machine.pk}`, "PUT", path, body);
  expect((await fetch(relay + path, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body })).status).toBe(204);
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function until(what: string, ok: () => boolean, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(10);
  }
}

interface Fake {
  deps: ShellDeps;
  sends: TermSend[];
  keys: [string, string][];
  sizes: [string, number, number][];
  started: number;
  closed: number;
  log: string[][];
  yours: Set<string>;
  on: { value: boolean };
  clock: { at: number };
}

function fake(over: Partial<ShellDeps> = {}): Fake {
  const f: Fake = { sends: [], keys: [], sizes: [], started: 0, closed: 0, log: [], yours: new Set([person.pk]), on: { value: true }, clock: { at: 1_000_000 }, deps: null as never };
  f.deps = {
    machine: () => ({ identity: machine, relay }),
    on: () => f.on.value,
    mine: async (want) => ({ ok: true, pane: want === "new" ? "%5" : want }),
    term: async (_pane, cols, rows, send) => {
      f.sends.push(send);
      return { opened: { window: "@2", cols, rows, seed: "SEED", dead: false }, start: () => void f.started++, close: () => void f.closed++ };
    },
    keys: (pane, text) => (f.keys.push([pane, text]), true),
    resize: (pane, cols, rows) => (f.sizes.push([pane, cols, rows]), true),
    tabs: async () => [{ pane: "%5", label: "zsh" }],
    closeTab: async () => [],
    yours: async (by) => f.yours.has(by),
    log: (row) => void f.log.push(row),
    now: () => f.clock.at,
    pairMs: 2_000,
    ...over,
  };
  return f;
}

interface App {
  ws: WebSocket;
  pipe: Pipe;
  got: unknown[];
  closed: Promise<number>;
}

async function ask(f: Fake, want = "new"): Promise<{ result: ShellResult; join: () => Promise<App> }> {
  const key = await newShellKey();
  const id = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const askId = `shell_${id.slice(0, 10)}`;
  const shells = (f as Fake & { shells?: ReturnType<typeof remoteShells> }).shells ?? remoteShells(f.deps);
  (f as Fake & { shells?: ReturnType<typeof remoteShells> }).shells = shells;
  const result = await shells.open({ want, cols: 100, rows: 30, pipe: id, epk: key.epk }, askId, person.pk);
  const join = async (): Promise<App> => {
    if (!result.ok || !("epk" in result)) throw new Error("no shell to join");
    const pipe = await openPipe(key, "app", { pipe: id, ask: askId, machine: machine.pk, app: key.epk, computer: result.epk });
    const path = `/v1/machine/${machine.pk}/pipe/${id}`;
    const ws = new WebSocket(relay.replace(/^http/, "ws") + path, [WS_PROTOCOL, await signRequest(person, `machine:${machine.pk}`, "GET", path, "")]);
    ws.binaryType = "arraybuffer";
    const got: unknown[] = [];
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") void pipe.open(new Uint8Array(e.data as ArrayBuffer)).then((m) => got.push(m));
    };
    const closed = new Promise<number>((resolve) => ws.addEventListener("close", (e) => resolve(e.code)));
    await new Promise<void>((resolve) => (ws.onopen = () => resolve()));
    return { ws, pipe, got, closed };
  };
  return { result, join };
}

const shellsOf = (f: Fake) => (f as Fake & { shells: ReturnType<typeof remoteShells> }).shells;

describe("a shell opened from another device", () => {
  test("answers with its key and pane, then streams the screen and output, and runs keys and sizes", async () => {
    const f = fake();
    const { result, join } = await ask(f);
    expect(result).toMatchObject({ ok: true, pane: "%5", window: "@2", cols: 100, rows: 30 });
    const app = await join();
    await until("the seed", () => app.got.length > 0);
    expect(app.got[0]).toEqual({ out: "SEED" });
    expect(f.started).toBe(1);
    f.sends[0]!({ out: "hel" });
    f.sends[0]!({ out: "lo" });
    await until("output", () => app.got.length > 1);
    expect(app.got[1]).toEqual({ out: "hello" });
    app.ws.send(await app.pipe.seal({ keys: "ls\r" }));
    app.ws.send(await app.pipe.seal({ size: { cols: 1_000, rows: 2 } }));
    await until("keys and size", () => f.keys.length === 1 && f.sizes.length === 1);
    expect(f.keys).toEqual([["%5", "ls\r"]]);
    expect(f.sizes).toEqual([["%5", 400, 5]]);
    expect(shellsOf(f).count()).toBe(1);
    app.ws.send(await app.pipe.seal({ close: true }));
    await until("the shell to close", () => shellsOf(f).count() === 0 && f.closed === 1);
    expect(f.log.map((r) => r.slice(0, 2))).toEqual([
      ["shell", "opened"],
      ["shell", "closed"],
    ]);
  });

  test("tells the device when the pane exits, then closes", async () => {
    const f = fake();
    const { join } = await ask(f);
    const app = await join();
    await until("the seed", () => app.got.length > 0);
    f.sends[0]!({ ended: true });
    await until("ended", () => app.got.some((m) => JSON.stringify(m) === '{"ended":true}'));
    await app.closed;
    expect(shellsOf(f).count()).toBe(0);
  });

  test("is refused when shells are off, past the open cap, or past the minute's opens", async () => {
    const off = fake();
    off.on.value = false;
    expect((await ask(off)).result).toMatchObject({ ok: false, why: "not-allowed" });
    expect(await remoteShells(off.deps).tabs()).toMatchObject({ ok: false, why: "not-allowed" });

    const full = fake();
    const apps = [];
    for (let i = 0; i < REMOTE_SHELLS; i++) apps.push(await (await ask(full)).join());
    expect((await ask(full)).result).toMatchObject({ ok: false, why: "failed" });
    for (const a of apps) a.ws.close();
    await until("all closed", () => shellsOf(full).count() === 0);

    const busy = fake({ term: async () => Promise.reject(new Error("no pane")) });
    for (let i = 0; i < SHELL_OPENS_PER_MINUTE; i++) expect((await ask(busy)).result).toMatchObject({ ok: false, detail: "no pane" });
    expect((await ask(busy)).result).toMatchObject({ ok: false, detail: expect.stringContaining("each minute") });
    busy.clock.at += 60_000;
    expect((await ask(busy)).result).toMatchObject({ ok: false, detail: "no pane" });
  });

  test("ends when the device that opened it is removed, or never joins, or sends a frame that doesn't open", async () => {
    const f = fake();
    const app = await (await ask(f)).join();
    await until("the seed", () => app.got.length > 0);
    f.yours.clear();
    await shellsOf(f).recheck();
    expect(await app.closed).toBe(1000);
    expect(f.log.at(-1)).toContain("the device that opened it was removed");

    const lonely = fake({ pairMs: 200 });
    await ask(lonely);
    await until("the unjoined shell to end", () => shellsOf(lonely).count() === 0, 3_000);

    const forged = fake();
    const bad = await (await ask(forged)).join();
    await until("the seed", () => bad.got.length > 0);
    bad.ws.send(new Uint8Array(40));
    expect(await bad.closed).toBe(1000);
    expect(forged.keys).toEqual([]);
  });
});
