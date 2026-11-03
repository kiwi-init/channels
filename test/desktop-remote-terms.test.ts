import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { certifyMachine } from "@kiwi/core/person.ts";
import type { TermEvent } from "../desktop/src/bridge.ts";
import { machineOnline, type Asker } from "../desktop/src/remote.ts";
import { isRemoteTerm, remoteClose, remoteKeys, remoteSize, remoteTabClose, remoteTabs, termRemote } from "../desktop/src/remote-terms.ts";
import type { TermSend } from "../src/daemon/hosted-term.ts";
import { startMachineInbox } from "../src/daemon/inbox.ts";
import type { PairedMachine } from "../src/daemon/pair.ts";
import { remoteRunner } from "../src/daemon/remote.ts";
import { remoteShells, type RemoteShells } from "../src/daemon/shells.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(30_000);

const root = mkdtempSync(join(tmpdir(), "kiwi-desktop-remote-terms-"));
let server: ReturnType<typeof startRelay>;
let inbox: { stop(): void };
let shells: RemoteShells;
let asker: Asker;
let person: Identity;
let vps: { pk: string; xpk: string };
const sends: TermSend[] = [];
const keys: string[] = [];
const sizes: [number, number][] = [];
const closedTabs: string[] = [];
let on = true;

async function until(what: string, ok: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(root, "relay") });
  const relay = server.url.origin;
  person = await withExchangeKey(await generateIdentity("person"));
  const machine = await withExchangeKey(await generateIdentity("vps"));
  vps = { pk: machine.pk, xpk: machine.xpk! };
  const cert = await certifyMachine(person, { pk: machine.pk, xpk: machine.xpk!, label: "vps" });
  const paired: PairedMachine = { identity: machine, label: "vps", relay, cert, person: { pk: person.pk, xpk: person.xpk!, name: "person" } };
  shells = remoteShells({
    machine: () => ({ identity: machine, relay }),
    on: () => on,
    mine: async (want) => ({ ok: true, pane: want === "new" ? "%7" : "%5" }),
    term: async (_pane, cols, rows, send) => {
      sends.push(send);
      return { opened: { window: "@1", cols, rows, seed: "SEED", dead: false }, start: () => {}, close: () => {} };
    },
    keys: (_pane, text) => (keys.push(text), true),
    resize: (_pane, cols, rows) => (sizes.push([cols, rows]), true),
    tabs: async () => [{ pane: "%5", label: "zsh" }],
    closeTab: async (pane) => (closedTabs.push(pane), []),
    yours: async (by) => by === person.pk,
    log: () => {},
  });
  inbox = startMachineInbox({
    dir: root,
    machine: () => paired,
    unpaired: async () => {},
    listed: async () => false,
    run: remoteRunner({ inventory: async () => [], folders: () => [], launch: async () => ({ ok: false, why: "failed", detail: "" }), shells }),
    checkMs: 100,
  });
  asker = { signer: person, person: person.pk, relay };
  for (let i = 0; i < 100 && !(await machineOnline(asker, vps.pk)); i++) await Bun.sleep(50);
  expect(await machineOnline(asker, vps.pk)).toBe(true);
});

afterAll(() => {
  shells.stop();
  inbox.stop();
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
});

describe("a shell on another of your computers, from the desktop", () => {
  test("opens through the relay, shows the screen, and carries keys and sizes", async () => {
    const events: TermEvent[] = [];
    const opened = await termRemote(asker, vps, null, 100, 30, (e) => events.push(e));
    expect(opened).toMatchObject({ ok: true, pane: "%5", window: "@1", cols: 100, rows: 30, seed: "", dead: false });
    if (!opened.ok) return;
    expect(isRemoteTerm(opened.term)).toBe(true);
    await until("the screen", () => events.some((e) => "out" in e && e.out === "SEED"));
    sends.at(-1)!({ out: "$ " });
    await until("output", () => events.some((e) => "out" in e && e.out === "$ "));
    expect(remoteKeys(opened.term, "ls\r")).toBe(true);
    expect(remoteSize(opened.term, 120, 40)).toBe(true);
    await until("keys and size", () => keys.includes("ls\r") && sizes.some(([c, r]) => c === 120 && r === 40));
    expect(remoteClose(opened.term)).toBe(true);
    expect(isRemoteTerm(opened.term)).toBe(false);
    await until("the computer to close it", () => shells.count() === 0);
    expect(events.some((e) => "lost" in e || "ended" in e)).toBe(false);
  });

  test("hears when the shell exits, and when the computer goes away", async () => {
    const events: TermEvent[] = [];
    const first = await termRemote(asker, vps, "new", 80, 24, (e) => events.push(e));
    expect(first).toMatchObject({ ok: true, pane: "%7" });
    await until("the screen", () => events.length > 0);
    sends.at(-1)!({ ended: true });
    await until("ended", () => events.some((e) => "ended" in e));

    const lost: TermEvent[] = [];
    const second = await termRemote(asker, vps, "%5", 80, 24, (e) => lost.push(e));
    expect(second.ok).toBe(true);
    await until("the screen", () => lost.length > 0);
    shells.stop();
    await until("lost", () => lost.some((e) => "lost" in e));
  });

  test("lists and closes that computer's tabs, and says why when shells are off", async () => {
    expect(await remoteTabs(asker, vps)).toEqual([{ pane: "%5", label: "zsh" }]);
    expect(await remoteTabClose(asker, vps, "%5")).toEqual([]);
    expect(closedTabs).toEqual(["%5"]);
    on = false;
    const refused = await termRemote(asker, vps, null, 80, 24, () => {});
    expect(refused).toEqual({ ok: false, detail: expect.stringContaining("kiwi shells on") });
    on = true;
    expect(await termRemote(asker, vps, "bogus", 80, 24, () => {})).toMatchObject({ ok: false });
  });
});
