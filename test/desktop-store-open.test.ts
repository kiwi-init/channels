import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useHost } from "../desktop/src/host.ts";
import { brokenStore, mutate, openStore, store, type StoreFile } from "../desktop/src/store.ts";
import { fakeHost } from "./fake-host.ts";

const logs = mkdtempSync(join(tmpdir(), "kiwi-store-open-"));
useHost(fakeHost({ paths: { logs } }).host);
const mainLog = (): string => (existsSync(join(logs, "main.log")) ? readFileSync(join(logs, "main.log"), "utf8") : "");

test("a vault whose load throws partway leaves the store broken: nothing is ever saved over either copy", () => {
  const saved: StoreFile[] = [];
  const failing = {
    where: () => "/data/kiwi-store.bin",
    load: (): never => {
      throw new Error("EACCES: the backup couldn't be written back over the main file");
    },
    save: (file: StoreFile) => void saved.push(file),
  };
  expect(() => openStore(failing)).not.toThrow();
  expect(() => mutate((s) => (s.relayUrl = "https://elsewhere.example"))).toThrow("Channels can't read its saved keys (EACCES: the backup couldn't be written back over the main file)");
  expect(saved).toEqual([]);
  expect(store.relayUrl).not.toBe("https://elsewhere.example");
  expect(brokenStore()?.message).toContain("The file is /data/kiwi-store.bin.");
  expect(mainLog()).toContain("EACCES: the backup couldn't be written back over the main file");
});

test("a load that fails with an empty reason still leaves the store broken (T855)", () => {
  const saved: StoreFile[] = [];
  openStore({ where: () => "/data/kiwi-store.bin", load: () => ({ ok: false, why: "" }), save: (file) => void saved.push(file) });
  expect(() => mutate((s) => (s.relayUrl = "https://elsewhere.example"))).toThrow("Channels can't read its saved keys (an error with no message)");
  expect(saved).toEqual([]);
});

test("a load that throws an error with no message is broken too, and main.log keeps what was thrown (T855)", () => {
  const saved: StoreFile[] = [];
  openStore({
    where: () => "/data/kiwi-store.bin",
    load: (): never => {
      throw new TypeError("");
    },
    save: (file) => void saved.push(file),
  });
  expect(brokenStore()).not.toBeNull();
  expect(() => mutate((s) => (s.relayUrl = "https://elsewhere.example"))).toThrow("can't read its saved keys");
  expect(saved).toEqual([]);
  expect(mainLog()).toContain("TypeError");
});

test("a store that opens after a broken one is writable again", () => {
  const saved: StoreFile[] = [];
  openStore({ where: () => "/data/kiwi-store.bin", load: () => ({ ok: true, file: null, resave: false }), save: (file) => void saved.push(structuredClone(file)) });
  expect(brokenStore()).toBeNull();
  mutate((s) => (s.relayUrl = "https://r.example"));
  expect(saved.map((f) => f.relayUrl)).toEqual(["https://r.example"]);
});
