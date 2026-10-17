import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BackupError,
  deleteBackup,
  getBackup,
  openBackup,
  putBackup,
  sealBackup,
} from "../src/backup.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import {
  hourlyLimit,
  onBackupHttp,
  type BackupRecord,
  type BackupStore,
} from "../src/relay/backup.ts";
import { startRelay } from "../src/relay/bun.ts";

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-backup-relay-"));
let server: ReturnType<typeof startRelay> | undefined;
let relay = "";
const fast = { N: 2 ** 14, r: 8, p: 1 };
const words = "alpha bravo charlie delta echo foxtrot";
const isKeys = (v: unknown): v is { person: string } =>
  !!v && typeof v === "object" && "person" in v;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth() });
  relay = server.url.origin;
});
afterAll(() => {
  server?.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("the relay's backup", () => {
  test("a signed-in person stores a sealed backup and another device opens it with the passphrase", async () => {
    const env = await sealBackup(words, { person: "THE-KEY" }, fast);
    await putBackup(relay, "dev:ada", env);
    const got = await getBackup(relay, "dev:ada");
    expect(got?.envelope).toEqual(env);
    expect(await openBackup(words, got!.envelope, isKeys)).toEqual({ person: "THE-KEY" });
  });

  test("the relay's copy holds no key material and no passphrase", async () => {
    const env = await sealBackup(words, { person: "THE-KEY" }, fast);
    await putBackup(relay, "dev:bo", env);
    const raw = await (
      await fetch(`${relay}/v1/backup`, { headers: { "x-human-token": "dev:bo" } })
    ).text();
    expect(raw).not.toContain("THE-KEY");
    expect(raw).not.toContain("alpha");
  });

  test("only the signed-in owner reaches it", async () => {
    await putBackup(relay, "dev:cy", await sealBackup(words, { person: "x" }, fast));
    expect(await getBackup(relay, "dev:dee")).toBeNull();
    const anon = await fetch(`${relay}/v1/backup`);
    expect(anon.status).toBe(401);
    await expect(getBackup(relay, "nonsense")).rejects.toBeInstanceOf(BackupError);
  });

  test("it can be replaced and deleted", async () => {
    await putBackup(relay, "dev:eve", await sealBackup(words, { person: "one" }, fast));
    const two = await sealBackup(words, { person: "two" }, fast);
    await putBackup(relay, "dev:eve", two);
    expect((await getBackup(relay, "dev:eve"))?.envelope).toEqual(two);
    await deleteBackup(relay, "dev:eve");
    expect(await getBackup(relay, "dev:eve")).toBeNull();
  });

  test("it refuses what is not a backup, and a backup that is too large", async () => {
    const put = (body: string) =>
      fetch(`${relay}/v1/backup`, { method: "PUT", headers: { "x-human-token": "dev:fay" }, body });
    expect((await put(JSON.stringify({ envelope: { v: 1 } }))).status).toBe(400);
    expect((await put("not json")).status).toBe(400);
    expect((await put("x".repeat(300 * 1024))).status).toBe(413);
  });
});

describe("the backup route alone", () => {
  const memory = (): BackupStore => {
    const rows = new Map<string, BackupRecord>();
    return {
      load: async (u) => rows.get(u) ?? null,
      save: async (u, r) => void rows.set(u, r),
      drop: async (u) => void rows.delete(u),
    };
  };

  test("a relay without sign-in keeps no backups, and other paths are not its", async () => {
    expect(
      (await onBackupHttp(new Request("http://x/v1/backup"), memory(), { human: null }))?.status,
    ).toBe(404);
    expect(
      await onBackupHttp(new Request("http://x/v1/other"), memory(), { human: devHumanAuth() }),
    ).toBeNull();
  });

  test("requests over the hourly limit are turned away, and the limit is per person", async () => {
    const allow = hourlyLimit(2);
    const ask = (token: string) =>
      onBackupHttp(
        new Request("http://x/v1/backup", { headers: { "x-human-token": token } }),
        memory(),
        { human: devHumanAuth(), allow },
      );
    expect((await ask("dev:a"))?.status).toBe(404);
    expect((await ask("dev:a"))?.status).toBe(404);
    expect((await ask("dev:a"))?.status).toBe(429);
    expect((await ask("dev:b"))?.status).toBe(404);
  });
});
