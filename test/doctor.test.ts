import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import * as Effect from "effect/Effect";
import { checkShadowed, doctorChecks, type Finding } from "../src/cli/doctor.ts";
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

describe("kiwi doctor and a Homebrew kiwi", () => {
  const root = mkdtempSync(join(tmpdir(), "kiwi-doctor-brew-"));
  const home = join(root, "home");
  const old = join(home, ".kiwi", "bin");
  const prefix = join(root, "brew");
  const cellar = join(prefix, "Cellar", "kiwi", "2026.10.0", "bin");
  const tool = (dir: string, version: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "kiwi"), `#!/bin/sh\necho ${version}\n`);
    chmodSync(join(dir, "kiwi"), 0o755);
  };

  beforeAll(() => {
    tool(old, "0.27.6");
    tool(cellar, "2026.10.0");
    mkdirSync(join(prefix, "bin"), { recursive: true });
    symlinkSync(join(cellar, "kiwi"), join(prefix, "bin", "kiwi"));
    writeFileSync(join(home, ".zshrc"), `alias ll="ls -l"\n\n# Added by the Channels app: it keeps the kiwi CLI in ~/.kiwi/bin current.\nexport PATH="${old}:$PATH"\n`);
    writeFileSync(join(home, ".bash_profile"), "export EDITOR=vi\n");
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const shadowed = (path: string) => Effect.runPromise(checkShadowed(path, home, {}));

  test("an old ~/.kiwi/bin/kiwi ahead of Homebrew's is named with the fix, and the keys stay", async () => {
    expect(await shadowed([old, join(prefix, "bin"), "/usr/bin"].join(delimiter))).toEqual({
      ok: false,
      what: "~/.kiwi/bin/kiwi (0.27.6) comes before Homebrew's kiwi (2026.10.0) on PATH, so a shell runs the old one.",
      how: 'Remove it: rm ~/.kiwi/bin/kiwi, and delete the marked PATH lines in ~/.zshrc (each "# Added by …" line and the export under it), then open a new terminal. Your keys and seats in ~/.kiwi stay as they are.',
    });
  });

  test("with Homebrew's first, or no Homebrew kiwi at all, there's nothing to fix", async () => {
    expect(await shadowed([join(prefix, "bin"), old].join(delimiter))).toBeNull();
    expect(await shadowed([old, "/usr/bin"].join(delimiter))).toBeNull();
  });
});
