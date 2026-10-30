import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DeviceLink } from "@kiwi/core/devices.ts";
import { certifyMachine } from "@kiwi/core/person.ts";
import type { ComputerView } from "./bridge.ts";
import { compareVersions } from "@kiwi/core/versions.ts";
import { ensureOnPath, keepCli, place, type KeptCli } from "./cli.ts";
import { daemonAdopt, daemonHello, daemonSocketPath, daemonStop, daemonUnpair, kiwiHome, noteDaemon, spawnDaemon, type HelloResult } from "./daemon-client.ts";
import { keepAlive } from "./daemon-keeper.ts";
import { host } from "./host.ts";
import { publicPerson } from "./guard.ts";
import { requirePerson, store, upsertComputer } from "./store.ts";
import { keepTmux } from "./tmux.ts";

function bundledKiwi(): string {
  const exe = process.platform === "win32" ? "kiwi.exe" : "kiwi";
  for (const name of [`${exe}.zst`, "kiwi.js", exe]) {
    const fromPkg = path.join(host().app.path("resources"), name);
    if (host().app.packaged() && fs.existsSync(fromPkg)) return fromPkg;
  }
  const fromRepo = path.join(__dirname, "..", "..", "dist", exe);
  if (fs.existsSync(fromRepo)) return fromRepo;
  throw new Error("the bundled kiwi binary is missing (repo root `bun run build` makes dist/kiwi)");
}

function bundledTmux(): string | null {
  if (process.platform === "win32") return null;
  const bundled = host().app.packaged() ? path.join(host().app.path("resources"), "tmux") : path.join(__dirname, "..", "..", "dist", "tmux");
  return fs.existsSync(bundled) ? bundled : null;
}

async function runnableKiwi(): Promise<string> {
  const bundled = bundledKiwi();
  if (!bundled.endsWith(".zst") && !bundled.endsWith(".js")) return bundled;
  const dir = path.join(host().app.path("data"), "bin");
  const name = `kiwi-${host().app.version()}`;
  const unpacked = path.join(dir, name);
  if (fs.existsSync(unpacked)) return unpacked;
  await place(bundled, unpacked);
  for (const old of await fs.promises.readdir(dir)) if (old.startsWith("kiwi-") && old !== name) await fs.promises.rm(path.join(dir, old), { force: true });
  return unpacked;
}

let kiwiBin: { path: string; version: string } | null = null;

export async function kiwiCli(): Promise<string> {
  return kiwiBin?.path ?? (await runnableKiwi());
}

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

type ListComputer = (m: { pk: string; xpk: string; label: string }) => Promise<DeviceLink[] | null>;

export async function adoptDaemon(listComputer: ListComputer): Promise<ComputerView> {
  const who = publicPerson(store.person) ?? store.enrolled ?? null;
  if (!who) throw new Error("make your person key first");
  const home = kiwiHome();
  const hello = (await daemonHello(home)) ?? (await ensureDaemon());
  if (!hello) throw new Error(`no daemon answers at ${daemonSocketPath(home)}`);
  const label = os.hostname().split(".")[0] || "this computer";
  const named = { pk: who.pk, xpk: who.xpk, name: who.name };
  if (hello.paired && hello.paired.person !== named.pk) await daemonUnpair(home);
  let links: DeviceLink[] | null;
  try {
    links = await listComputer({ pk: hello.machine.pk, xpk: hello.machine.xpk, label });
  } catch (err) {
    if (!store.person) throw err;
    // The person key still certifies this computer when the device list can't be reached or changed.
    links = null;
  }
  if (links) await daemonAdopt(home, { links, person: named });
  else {
    const person = requirePerson();
    await daemonAdopt(home, { cert: await certifyMachine(person, { pk: hello.machine.pk, xpk: hello.machine.xpk, label }), person: named });
  }
  const c: ComputerView = { label, os: process.platform, machinePk: hello.machine.pk, machineXpk: hello.machine.xpk, personPk: who.pk, at: Date.now(), own: true };
  upsertComputer(c);
  return c;
}

async function keepOwnCli(): Promise<KeptCli> {
  const kept = await keepCli(bundledKiwi(), host().app.version());
  if (!kept.homebrew) ensureOnPath();
  kiwiBin = !kept.homebrew || compareVersions(kept.version, host().app.version()) >= 0 ? kept : { path: await runnableKiwi(), version: host().app.version() };
  return kept;
}

export async function installCli(): Promise<{ path: string }> {
  return { path: (await keepOwnCli()).path };
}

export async function keepDaemon(stopped: () => boolean): Promise<void> {
  if (host().app.packaged()) {
    try {
      await keepOwnCli();
    } catch {
      // The daemon still runs from the app's own copy, and an older one must give way to it.
      kiwiBin = await runnableKiwi().then(
        (bin) => ({ path: bin, version: host().app.version() }),
        () => null,
      );
    }
  }
  const tmux = bundledTmux();
  if (tmux) await keepTmux(tmux, kiwiHome()).catch(() => null);
  await ensureDaemon().catch(() => null);
  await keepAlive({
    hello: async () => (await daemonHello(kiwiHome(), 2_000)) !== null,
    start: async () => (await ensureDaemon().catch(() => null)) !== null,
    log: (line) => noteDaemon(line),
    stopped,
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
}
