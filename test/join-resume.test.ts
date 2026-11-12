import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeJoinCode } from "@kiwi/core/crypto.ts";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { makePin } from "@kiwi/core/pin.ts";
import { PRESETS } from "@kiwi/core/presets.ts";
import { startRelay } from "../src/relay/bun.ts";
import { memoryBudget } from "./check.ts";
import { kiwiCmd } from "./owner.ts";

setDefaultTimeout(60_000);

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-join-resume-${tag}-`));
  made.push(d);
  return d;
};

let server: ReturnType<typeof startRelay>;
let relay: string;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: scratch("relay") });
  relay = server.url.origin;
});

afterAll(() => {
  server.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

function run(home: string, args: string[]) {
  const p = Bun.spawn(kiwiCmd(["join", ...args]), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()] as const).then(([exit, out, err]) => ({ exit, out, err }));
}

test("a resumed key says it ignored --persona and --nick instead of dropping them silently (#2312)", async () => {
  const owner = await generateIdentity("boss");
  const { code, access } = await Channel.create(relay, owner, { name: "boss" });
  const ownerCh = new Channel(access, relay, owner);
  const token = await makePin(
    owner,
    decodeJoinCode(code).roomId,
    PRESETS.find((p) => p.id === "reviewer")!,
  );
  const home = scratch("home");

  const first = run(home, [code, "--as", "dev", "--model", "test-model"]);
  const budget = memoryBudget();
  const deadline = Date.now() + 20_000;
  let ready = (await ownerCh.requests({ budget }))[0];
  while (ready?.check !== "ready") {
    if (Date.now() > deadline) throw new Error("the first request never got its code");
    await Bun.sleep(100);
    ready = (await ownerCh.requests({ budget }))[0];
  }
  await ownerCh.approve(ready);
  const joined = await first;
  expect(joined.exit).toBe(0);

  const resumed = await run(home, [code, "--as", "dev", "--model", "test-model", "--nick", "renamed", "--persona", token]);
  expect(resumed.exit).toBe(0);
  expect(resumed.out).toContain("resumed");
  const said = `${resumed.out}\n${resumed.err}`;
  expect(said).toContain("--persona");
  expect(said).toContain("--nick");
  expect(said).toContain("ignored");
});
