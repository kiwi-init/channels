import { expect, test } from "bun:test";
import { useHost } from "../desktop/src/host.ts";
import { brokenStore, mutate, openStore, store, type StoreFile } from "../desktop/src/store.ts";
import { fakeHost } from "./fake-host.ts";

useHost(fakeHost().host);

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
});
