import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorChecks, type Finding } from "../src/cli/doctor.ts";
import { newMachine, saveMachine, type MachineFile } from "../src/machine.ts";
import { startRelay } from "../src/relay/bun.ts";
import { workosHumanAuth } from "../src/relay/human.ts";

// A stand-in for WorkOS, same shape as test/human.test.ts: the relay can confirm and remove a computer.
const rsa = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, [
  "sign",
  "verify",
])) as CryptoKeyPair;
const jwk = (await crypto.subtle.exportKey("jwk", rsa.publicKey)) as { n: string; e: string };
const jwks = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: () => Response.json({ keys: [{ kty: "RSA", kid: "k1", alg: "RS256", use: "sig", n: jwk.n, e: jwk.e }] }),
});

const human = {
  ...workosHumanAuth("client_test", `${jwks.url.origin}/jwks`),
  profile: async (u: string) => (u === "user_alice" ? { name: "Alice Owner", email: "alice@example.com" } : null),
};

const tmp = mkdtempSync(join(tmpdir(), "kiwi-doctor-"));
let openRelay: ReturnType<typeof startRelay>;
let signedIn: ReturnType<typeof startRelay>;

beforeAll(() => {
  openRelay = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(tmp, "open") });
  signedIn = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(tmp, "signed"), human });
});
afterAll(() => {
  openRelay.stop(true);
  signedIn.stop(true);
  jwks.stop(true);
  rmSync(tmp, { recursive: true, force: true });
});

/** Run the checks with a throwaway home, then put the environment back. */
async function checks(env: Record<string, string>): Promise<Finding[]> {
  const prev = { KIWI_HOME: process.env.KIWI_HOME, KIWI_RELAY: process.env.KIWI_RELAY };
  const home = mkdtempSync(join(tmp, "home-"));
  process.env.KIWI_HOME = home;
  process.env.KIWI_RELAY = env.KIWI_RELAY;
  try {
    return await doctorChecks();
  } finally {
    if (prev.KIWI_HOME === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = prev.KIWI_HOME;
    if (prev.KIWI_RELAY === undefined) delete process.env.KIWI_RELAY;
    else process.env.KIWI_RELAY = prev.KIWI_RELAY;
  }
}

const mentionsLink = (f: Finding) => /link|kiwi setup/i.test(`${f.what}\n${"how" in f ? f.how : ""}`);

describe("kiwi doctor", () => {
  test("a relay with no sign-in is not asked for a computer link", async () => {
    const found = await checks({ KIWI_RELAY: openRelay.url.origin });
    expect(found.some((f) => f.ok && f.what.includes("/v1/config answered"))).toBe(true);
    expect(found.some(mentionsLink)).toBe(false);
  });

  test("an unreachable relay is reported as down, not as a missing link", async () => {
    const found = await checks({ KIWI_RELAY: "http://127.0.0.1:1" });
    const down = found.find((f) => !f.ok && f.what.includes("http://127.0.0.1:1"));
    expect(down?.ok).toBe(false);
    expect(found.some(mentionsLink)).toBe(false);
  });

  test("a paired computer says whose it is; an unpaired one is fine too", async () => {
    const relay = openRelay.url.origin;
    const prev = { KIWI_HOME: process.env.KIWI_HOME, KIWI_RELAY: process.env.KIWI_RELAY };
    const home = mkdtempSync(join(tmp, "home-"));
    process.env.KIWI_HOME = home;
    process.env.KIWI_RELAY = relay;
    try {
      expect((await doctorChecks()).some((f) => f.ok && f.what.startsWith("paired   no"))).toBe(true);
      const m = await newMachine(relay);
      saveMachine({ ...m, cert: { name: "Alice Owner" } } as MachineFile);
      expect((await doctorChecks()).some((f) => f.ok && f.what.startsWith("paired   with Alice Owner"))).toBe(true);
    } finally {
      if (prev.KIWI_HOME === undefined) delete process.env.KIWI_HOME;
      else process.env.KIWI_HOME = prev.KIWI_HOME;
      if (prev.KIWI_RELAY === undefined) delete process.env.KIWI_RELAY;
      else process.env.KIWI_RELAY = prev.KIWI_RELAY;
    }
  });
});
