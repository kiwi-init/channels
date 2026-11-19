import { spawnOwned } from "./owned.ts";
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  const token = await makePin(
    owner,
    decodeJoinCode(code).roomId,
    PRESETS.find((p) => p.id === "builder")!,
  );
  return { code, ownerCh: new Channel(access, relay, owner), token };
}

const edited = (token: string, change: (o: { pk: string; sig: string }) => void) => {
  const o = JSON.parse(new TextDecoder().decode(fromB64url(token))) as { pk: string; sig: string };
  change(o);
  return b64url(new TextEncoder().encode(JSON.stringify(o)));
};

const withBentKey = (token: string) => {
  const o = JSON.parse(new TextDecoder().decode(fromB64url(token))) as { pk: string };
  o.pk = `${o.pk.slice(0, 15)}${o.pk[15] === "Z" ? "J" : "Z"}${o.pk.slice(16)}`;
  return b64url(new TextEncoder().encode(JSON.stringify(o)));
};

function run(code: string, persona: string, timeout: string, extra: Record<string, string> = {}) {
  const p = spawnOwned(kiwiCmd(["join", code, "--as", "dev", "--model", "test-model", "--persona", persona, "--timeout", timeout]), {
    cwd: scratch("work"),
    env: { ...process.env, KIWI_HOME: scratch("home"), KIWI_RELAY: relay, CLAUDECODE: "", CLAUDE_CONFIG_DIR: scratch("claude"), CLAUDE_PROJECT_DIR: "", ...extra },
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

const notSigned = async (persona: (token: string) => string) => {
  const { code, ownerCh, token } = await ownedWithInvite();
  const { exit, out, err } = await run(code, persona(token), "8s");
  expect([exit, err]).toEqual([2, expect.stringContaining("this invite token failed verification")]);
  expect(err).not.toMatch(/^\s+at /m);
  expect(out).not.toContain("asked to join");
  expect(await ownerCh.requests({})).toEqual([]);
};

test("an invite token with a wrong signature still says it isn't signed by the owner", () =>
  notSigned((token) => edited(token, (o) => void (o.sig = `${o.sig.slice(0, 20)}${o.sig[20] === "A" ? "B" : "A"}${o.sig.slice(21)}`))));

test("an invite token whose key is cut short still says it isn't signed by the owner", () => notSigned((token) => edited(token, (o) => void (o.pk = o.pk.slice(0, 40)))));

test("a verifier that throws makes join say verification could not run, before any request", async () => {
  const { code, ownerCh, token } = await ownedWithInvite();
  const preload = join(scratch("preload"), "verify-throws.js");
  writeFileSync(
    preload,
    `const real = crypto.subtle.verify.bind(crypto.subtle);\n` +
      `Object.defineProperty(crypto.subtle, "verify", { configurable: true, value: (alg, ...rest) => ((typeof alg === "string" ? alg : alg.name) === "Ed25519" ? Promise.reject(new DOMException("injected verifier failure", "OperationError")) : real(alg, ...rest)) });\n`,
  );
  const { exit, out, err } = await run(code, token, "8s", { BUN_OPTIONS: `--preload=${preload}` });
  expect([exit, err]).toEqual([1, expect.stringContaining("verification could not run: OperationError: injected verifier failure, run the command again")]);
  expect(err).not.toContain("failed verification");
  expect(err).not.toMatch(/^\s+at /m);
  expect(out).not.toContain("asked to join");
  expect(await ownerCh.requests({})).toEqual([]);
});
