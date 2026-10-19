import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMachine } from "../src/daemon/pair.ts";
import { loadMachine, newMachine, saveMachine } from "../src/machine.ts";

let home = "";
const prevHome = process.env.KIWI_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kiwi-machine-file-"));
  process.env.KIWI_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test("saving the computer's key keeps a backup beside it", async () => {
  const m = await newMachine("https://relay.example");
  saveMachine(m);
  expect(readFileSync(join(home, "machine.json.bak"), "utf8")).toBe(readFileSync(join(home, "machine.json"), "utf8"));
});

test("a machine.json cut short comes back from its backup, and the computer keeps its key", async () => {
  const m = await newMachine("https://relay.example");
  saveMachine(m);
  writeFileSync(join(home, "machine.json"), '{"identity": {"pk": "');
  expect(loadMachine()?.identity.pk).toBe(m.identity.pk);
  expect(readFileSync(join(home, "machine.json"), "utf8")).toBe(readFileSync(join(home, "machine.json.bak"), "utf8"));
  expect((await ensureMachine("https://relay.example")).identity.pk).toBe(m.identity.pk);
});

test("a machine.json that can't be read, with no backup, stops instead of making this computer a new key", async () => {
  writeFileSync(join(home, "machine.json"), "not json");
  expect(() => loadMachine()).toThrow(`${join(home, "machine.json")} is unreadable and there is no backup of it`);
  await expect(ensureMachine("https://relay.example")).rejects.toThrow("is unreadable");
  expect(readFileSync(join(home, "machine.json"), "utf8")).toBe("not json");
  expect(existsSync(join(home, "machine.json.bak"))).toBe(false);
});
