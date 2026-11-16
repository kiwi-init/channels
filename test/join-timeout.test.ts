import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/bun.ts";
import { saveMachine } from "../src/machine.ts";
import type { PairedMachine } from "../src/daemon.ts";
import { kiwiCmd, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";
import { memoryBudget } from "./check.ts";
import { spawnOwned } from "./owned.ts";

setDefaultTimeout(60_000);

const TIMEOUT_S = 3;
const ALLOWANCE_MS = 2_000;
const scratch = mkdtempSync(join(tmpdir(), "kiwi-join-timeout-"));
const dataDir = join(scratch, "relay");
mkdirSync(dataDir);

let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;
const silent = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 0, fetch: () => new Promise<Response>(() => {}) });

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin);
});

afterAll(() => {
  silent.stop(true);
  server.stop(true);
  rmSync(scratch, { recursive: true, force: true });
});

const homeFor = (name: string) => {
  const home = join(scratch, name);
  mkdirSync(home, { recursive: true });
  return home;
};

function join_(home: string, code: string, relay: string, extra: Record<string, string> = {}) {
  const env = { ...process.env, HOME: home, KIWI_HOME: join(home, "kiwi"), KIWI_RELAY: relay, KIWI_MODEL: "test-model", KIWI_NO_HOOKS: "1", ...extra };
  const started = Date.now();
  const p = spawnOwned(kiwiCmd(["join", code, "--as", "probe", "--timeout", `${TIMEOUT_S}s`]), { env, cwd: home, stdout: "pipe", stderr: "pipe" });
  return { p, started };
}

async function exitsInTime(p: ReturnType<typeof spawnOwned>, started: number): Promise<number> {
  const code = await Promise.race([p.exited, Bun.sleep(TIMEOUT_S * 1000 + ALLOWANCE_MS + 500).then(() => null)]);
  expect(code === null ? `still running after ${Date.now() - started} ms` : "exited").toBe("exited");
  expect(Date.now() - started).toBeLessThanOrEqual(TIMEOUT_S * 1000 + ALLOWANCE_MS);
  return code ?? -1;
}

test("a relay that takes the request and never answers can't hold a join past its timeout", async () => {
  const { p, started } = join_(homeFor("hung"), "mc2-AAAAAAAAAAAAAAAAAAAAAA-BBBBBBBBBBBBBBBB", `http://127.0.0.1:${silent.port}`);
  expect(await exitsInTime(p, started)).toBe(3);
  expect(await new Response(p.stderr).text()).toContain("the owner hasn't opened your request yet");
});

test("a relay that is down ends the join at once", async () => {
  const { p, started } = join_(homeFor("down"), "mc2-AAAAAAAAAAAAAAAAAAAAAA-BBBBBBBBBBBBBBBB", "http://127.0.0.1:1");
  expect(await exitsInTime(p, started)).toBe(1);
});

test("a join whose home is deleted while it waits still ends within its timeout", async () => {
  const home = homeFor("gone");
  const { p, started } = join_(home, "mc2-AAAAAAAAAAAAAAAAAAAAAA-BBBBBBBBBBBBBBBB", `http://127.0.0.1:${silent.port}`);
  await Bun.sleep(500);
  rmSync(home, { recursive: true, force: true });
  await exitsInTime(p, started);
});

test("a daemon that never comes up can't hold a join past its timeout", async () => {
  const home = homeFor("no-daemon");
  const kiwiHome = join(home, "kiwi");
  mkdirSync(kiwiHome, { recursive: true });
  const prev = process.env.KIWI_HOME;
  process.env.KIWI_HOME = kiwiHome;
  try {
    const pc = await pairComputer(s.person, "stalled-computer");
    const paired: PairedMachine = { identity: pc.machine, label: "stalled-computer", relay: s.relay, cert: pc.cert, person: { pk: s.person.pk, xpk: s.person.xpk ?? "", name: "owner" } };
    saveMachine(paired);
  } finally {
    if (prev === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = prev;
  }
  writeFileSync(join(kiwiHome, "daemon.lock"), "1");
  writeFileSync(join(kiwiHome, "daemon.spawning"), "1");
  const { p, started } = join_(home, s.code, s.relay);
  expect(await exitsInTime(p, started)).toBe(3);
  expect(await new Response(p.stdout).text()).toContain("asked to join as probe");
});

test("a join the owner lets in keeps listening past its timeout, as it should", async () => {
  const budget = memoryBudget();
  const { p, started } = join_(homeFor("listening"), s.code, s.relay, { GROK_SESSION_ID: "join-timeout-test" });
  const end = Date.now() + 20_000;
  for (;;) {
    const waiting = (await s.ownerCh.requests({ budget })).find((r) => r.name === "probe" && r.check === "ready" && !!r.code);
    if (waiting) {
      await s.ownerCh.approve(waiting);
      break;
    }
    if (Date.now() > end) throw new Error("no join request reached the owner");
    await Bun.sleep(100);
  }
  await Bun.sleep(Math.max(0, started + TIMEOUT_S * 1000 + ALLOWANCE_MS + 1_000 - Date.now()));
  expect(p.exitCode).toBeNull();
  p.kill();
  await p.exited;
});
