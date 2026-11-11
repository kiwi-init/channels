import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64url, decodeJoinCode, fromB64url } from "@kiwi/core/crypto.ts";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { makePin } from "@kiwi/core/pin.ts";
import { PRESETS } from "@kiwi/core/presets.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";

setDefaultTimeout(60_000);

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-join-persona-${tag}-`));
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

async function ownedWithInvite() {
  const owner = await generateIdentity("boss");
  const { code, access } = await Channel.create(relay, owner, { name: "boss" });
  const token = await makePin(owner, decodeJoinCode(code).roomId, PRESETS.find((p) => p.id === "builder")!);
  return { code, ownerCh: new Channel(access, relay, owner), token };
}

const withBentKey = (token: string) => {
  const o = JSON.parse(new TextDecoder().decode(fromB64url(token))) as { pk: string };
  o.pk = `${o.pk.slice(0, 15)}${o.pk[15] === "Z" ? "J" : "Z"}${o.pk.slice(16)}`;
  return b64url(new TextEncoder().encode(JSON.stringify(o)));
};

function run(code: string, persona: string, timeout: string) {
  const p = Bun.spawn(kiwiCmd(["join", code, "--as", "dev", "--model", "test-model", "--persona", persona, "--timeout", timeout]), {
    cwd: scratch("work"),
    env: { ...process.env, KIWI_HOME: scratch("home"), KIWI_RELAY: relay, CLAUDECODE: "", CLAUDE_CONFIG_DIR: scratch("claude"), CLAUDE_PROJECT_DIR: "" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()] as const).then(([exit, out, err]) => ({ exit, out, err }));
}

test("an invite token that fails verification stops the join before any request", async () => {
  const { code, ownerCh, token } = await ownedWithInvite();
  const { exit, out, err } = await run(code, withBentKey(token), "8s");
  expect([exit, err]).toEqual([2, expect.stringContaining("this invite token failed verification")]);
  expect(out).not.toContain("asked to join");
  expect(await ownerCh.requests({})).toEqual([]);
});

test("a verifying token still reaches the owner as a pinned request", async () => {
  const { code, ownerCh, token } = await ownedWithInvite();
  const { exit, out } = await run(code, token, "4s");
  expect(exit).toBe(3);
  expect(out).toContain("asked to join as dev");
  const req = (await ownerCh.requests({}))[0];
  expect(req?.pin).toMatchObject({ id: "builder", name: "Builder" });
});
