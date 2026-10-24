import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_STORE_FILE, testVault } from "../desktop/src/eb-test-store.ts";

const root = mkdtempSync(join(tmpdir(), "kiwi-test-vault-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("a test build's store is a first run until saved, then comes back whole from a 0600 file in a 0700 folder", () => {
  const dir = join(root, "data");
  const vault = testVault(dir);
  expect(vault.load()).toEqual({ ok: true, file: null, resave: false });
  const store = { relayUrl: "http://127.0.0.1:8787", person: null, channels: [], computers: [], pending: [] };
  vault.save(store);
  expect(testVault(dir).load()).toEqual({ ok: true, file: store, resave: false });
  expect(statSync(join(dir, TEST_STORE_FILE)).mode & 0o777).toBe(0o600);
  expect(statSync(dir).mode & 0o777).toBe(0o700);
  expect(vault.where()).toBe(join(dir, TEST_STORE_FILE));
});

test("a file that isn't a store is refused whole, never read as a first run", () => {
  for (const [name, body, why] of [
    ["torn", '{"relayUrl": "http', "isn't JSON"],
    ["list", "[1, 2]", "isn't a store"],
    ["null", "null", "isn't a store"],
  ] as const) {
    const dir = join(root, name);
    testVault(dir).save({ relayUrl: "x", person: null, channels: [], computers: [], pending: [] });
    writeFileSync(join(dir, TEST_STORE_FILE), body);
    expect(testVault(dir).load()).toEqual({ ok: false, why: `${TEST_STORE_FILE} ${why}` });
  }
});
