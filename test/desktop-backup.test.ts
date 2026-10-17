import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openBackup } from "../src/backup.ts";
import { getBackup } from "../src/backup.ts";
import { createBackupHost, NOT_SIGNED_IN, NO_PERSON } from "../desktop/src/backup-host.ts";
import type { ChannelIdentityView, PersonView } from "../desktop/src/bridge.ts";
import { generateIdentity } from "../src/identity.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { startRelay } from "../src/relay/bun.ts";

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-desktop-backup-"));
let server: ReturnType<typeof startRelay> | undefined;
let relay = "";

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth() });
  relay = server.url.origin;
});
afterAll(() => {
  server?.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const isBackup = (v: unknown): v is { person: PersonView; channels: ChannelIdentityView[] } =>
  !!v && typeof v === "object" && "person" in v && "channels" in v;

async function person(): Promise<PersonView> {
  const id = await generateIdentity("Ada");
  return { name: id.name, pk: id.pk, sk: id.sk, xpk: id.xpk!, xsk: id.xsk! };
}

describe("the desktop app's backup", () => {
  test("seals the person and channels, shows the six words, and the relay copy opens only with them", async () => {
    const ada = await person();
    const host = createBackupHost({
      person: () => ada,
      channels: () => [],
      relay: () => relay,
      token: async () => "dev:ada",
    });
    expect(await host.status()).toBeNull();
    const made = await host.run();
    expect(made.passphrase.split(" ")).toHaveLength(6);
    expect((await host.status())?.at).toBeGreaterThan(0);
    const stored = await getBackup(relay, "dev:ada");
    const opened = await openBackup(made.passphrase, stored!.envelope, isBackup);
    expect(opened.person.sk).toBe(ada.sk);
    expect(JSON.stringify(stored)).not.toContain(ada.sk);
  });

  test("a second backup replaces the first, with new words", async () => {
    const ada = await person();
    const host = createBackupHost({
      person: () => ada,
      channels: () => [],
      relay: () => relay,
      token: async () => "dev:bea",
    });
    const one = await host.run();
    const two = await host.run();
    expect(two.passphrase).not.toBe(one.passphrase);
    await expect(
      openBackup(one.passphrase, (await getBackup(relay, "dev:bea"))!.envelope, isBackup),
    ).rejects.toThrow();
  });

  test("says why it can't: signed out, or no person key", async () => {
    const ada = await person();
    await expect(
      createBackupHost({
        person: () => ada,
        channels: () => [],
        relay: () => relay,
        token: async () => null,
      }).run(),
    ).rejects.toThrow(NOT_SIGNED_IN);
    await expect(
      createBackupHost({
        person: () => null,
        channels: () => [],
        relay: () => relay,
        token: async () => "dev:x",
      }).run(),
    ).rejects.toThrow(NO_PERSON);
  });
});
