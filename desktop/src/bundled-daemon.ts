import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

import { certifyMachine } from "@kiwi/core/person.ts";
import type { ComputerView } from "./bridge.ts";
import { compareVersions } from "@kiwi/core/versions.ts";
import { ensureOnPath, keepCli, place } from "./cli.ts";
import { daemonAdopt, daemonHello, daemonSocketPath, daemonStop, kiwiHome, noteDaemon, spawnDaemon, type HelloResult } from "./daemon-client.ts";
import { keepAlive } from "./daemon-keeper.ts";
import { requirePerson, store, upsertComputer } from "./store.ts";

function bundledKiwi(): string {
  const exe = process.platform === "win32" ? "kiwi.exe" : "kiwi";
  for (const name of [`${exe}.zst`, exe]) {
    const fromPkg = path.join(process.resourcesPath, name);
    if (app.isPackaged && fs.existsSync(fromPkg)) return fromPkg;
  }
  const fromRepo = path.join(__dirname, "..", "..", "dist", exe);
  if (fs.existsSync(fromRepo)) return fromRepo;
  throw new Error("the bundled kiwi binary is missing (repo root `bun run build` makes dist/kiwi)");
}

async function runnableKiwi(): Promise<string> {
  const bundled = bundledKiwi();
  if (!bundled.endsWith(".zst")) return bundled;
  const unpacked = path.join(app.getPath("userData"), "bin", `kiwi-${app.getVersion()}`);
  if (!fs.existsSync(unpacked)) await place(bundled, unpacked);
  return unpacked;
}

let kiwiBin: { path: string; version: string } | null = null;

async function ensureDaemon(): Promise<HelloResult | null> {
  const home = kiwiHome();
  const running = await daemonHello(home);
  if (running && !(kiwiBin && compareVersions(running.version, kiwiBin.version) < 0)) return running;
  if (running) {
    await daemonStop(home);
    for (let i = 0; i < 20 && (await daemonHello(home, 500)); i++) await new Promise((r) => setTimeout(r, 250));
  }
  spawnDaemon(kiwiBin?.path ?? (await runnableKiwi()), home, store.relayUrl);
  const until = Date.now() + 10_000;
  for (;;) {
    const hello = await daemonHello(home);
    if (hello) return hello;
    if (Date.now() > until) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function adoptDaemon(): Promise<ComputerView> {
  const person = requirePerson();
  const home = kiwiHome();
  const hello = (await daemonHello(home)) ?? (await ensureDaemon());
  if (!hello) throw new Error(`no daemon answers at ${daemonSocketPath(home)}`);
  const label = os.hostname().split(".")[0] || "this computer";
  const cert = await certifyMachine(person, { pk: hello.machine.pk, xpk: hello.machine.xpk, label });
  await daemonAdopt(home, { cert, person: { pk: person.pk, xpk: person.xpk as string, name: person.name } });
  const c: ComputerView = { label, os: process.platform, machinePk: hello.machine.pk, machineXpk: hello.machine.xpk, personPk: person.pk, at: Date.now(), own: true };
  upsertComputer(c);
  return c;
}

export async function installCli(): Promise<{ path: string }> {
  kiwiBin = await keepCli(bundledKiwi(), app.getVersion());
  ensureOnPath();
  return { path: kiwiBin.path };
}

export async function keepDaemon(stopped: () => boolean): Promise<void> {
  if (app.isPackaged) {
    try {
      kiwiBin = await keepCli(bundledKiwi(), app.getVersion());
      ensureOnPath();
    } catch {
      // The daemon still runs from the app's own copy below.
    }
  }
  await ensureDaemon().catch(() => null);
  await keepAlive({
    hello: async () => (await daemonHello(kiwiHome(), 2_000)) !== null,
    start: async () => (await ensureDaemon().catch(() => null)) !== null,
    log: (line) => noteDaemon(line),
    stopped,
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
}
