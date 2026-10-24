import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { loadConfig, saveConfig, saveIdentity } from "../src/config.ts";

const home = mkdtempSync(join(tmpdir(), "kiwi-wake-seats-"));
const prevHome = process.env.KIWI_HOME;
const room = "a".repeat(32);
const MAIN_TS = join(import.meta.dir, "..", "src", "cli", "main.ts");

function kiwi(args: string[]): { code: number; out: string } {
  const r = Bun.spawnSync([process.execPath, MAIN_TS, ...args], { cwd: home, env: { ...process.env, KIWI_HOME: home }, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() };
}

const seats = () => (JSON.parse(kiwi(["wake", "seats", "--json"]).out) as { seats: unknown[] }).seats;

beforeAll(async () => {
  process.env.KIWI_HOME = home;
  const owner = await generateIdentity("jow");
  const agent = await generateIdentity("atlas");
  saveConfig({ channels: { work: { roomId: room, ownerPk: owner.pk, ownerXpk: owner.xpk ?? "", epoch: 0, keys: {}, relay: "http://127.0.0.1:9", code: "mc2-x", owner: "jow", as: "atlas" } } });
  saveIdentity(owner, room);
  saveIdentity(agent, room);
});

afterAll(() => {
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test("the app turns an agent's wake off and on from this computer's own config, with no relay session (T14)", () => {
  expect(seats()).toEqual([{ room, alias: "work", agent: "atlas", wake: "on" }]);
  expect(JSON.parse(kiwi(["wake", "seat", room, "atlas", "off", "--json"]).out)).toEqual({ seats: [{ room, alias: "work", agent: "atlas", wake: "off" }] });
  expect(loadConfig().wakeOff).toEqual(["work/atlas"]);
  expect(kiwi(["wake", "seat", room, "atlas", "on"]).out.trim()).toBe("work/atlas: on");
  expect(loadConfig().wakeOff).toBeUndefined();
  expect(kiwi(["wake", "seat", room, "jow", "off"]).code).not.toBe(0);
  expect(kiwi(["wake", "seat", room, "nobody", "off"]).code).not.toBe(0);
  expect(kiwi(["wake", "seat", room, "atlas", "maybe"]).code).not.toBe(0);
});
