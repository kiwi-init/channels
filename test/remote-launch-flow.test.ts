import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { personFingerprint } from "@kiwi/core/fingerprint.ts";
import type { DeviceLink } from "@kiwi/core/devices.ts";
import { createDeviceHost } from "../desktop/src/devices.ts";
import { foldersOn, harnessesOn, launchOn, machineOnline } from "../desktop/src/remote.ts";
import { daemonSock, stopDaemon } from "../src/daemon.ts";
import { HostedTmux } from "../src/daemon/hosted-tmux.ts";
import { NO_REMOTE_BYPASS } from "../src/daemon/remote.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";

setDefaultTimeout(60_000);

const MAIN_TS = join(import.meta.dir, "..", "src", "cli", "main.ts");
const root = realpathSync(mkdtempSync(join(tmpdir(), "kiwi-remote-launch-")));
const home = join(root, "home");
const kiwiHome = join(root, "kiwi");
const bins = join(root, "bins");
const calls = join(root, "tmux-calls");
const repo = join(home, "code", "payments");
const forgotten = join(home, "code", "dotfiles");
const code = "mc2-AAAAAAAAAAAAAAAAAAAAAA-BBBBBBBBBBBBBBBB";
const TMUX = Bun.which("tmux");

function script(path: string, body: string): string {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

const env = (): Record<string, string> => ({
  ...(process.env as Record<string, string>),
  HOME: home,
  KIWI_HOME: kiwiHome,
  KIWI_NO_HOOKS: "1",
  SHELL: join(root, "login-shell"),
});
const kiwi = (args: string[]) => Bun.spawnSync([process.execPath, MAIN_TS, ...args], { cwd: root, env: { ...env(), KIWI_RELAY: relay }, stdout: "pipe", stderr: "pipe" });
const opened = (): string[][] =>
  readdirSync(calls)
    .map((f) => readFileSync(join(calls, f), "utf8").split("\n").filter(Boolean))
    .filter((argv) => argv.includes("new-window"));
const openedFor = (launch: string): string[] => {
  const found = opened().filter((argv) => argv.includes(`KIWI_LAUNCH=${launch}`));
  expect(found).toHaveLength(1);
  return found[0]!;
};

let server: ReturnType<typeof startRelay> | undefined;
let relay = "";
let person: Identity;
let machine: { pk: string; xpk: string; label: string };

async function digitsFrom(out: ReadableStream<Uint8Array>): Promise<string> {
  const reader = out.getReader();
  const text = new TextDecoder();
  let said = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`kiwi login ended before it showed its digits: ${said}`);
    said += text.decode(value);
    const m = /digits in your app: (\d{3}) (\d{3})/.exec(said);
    if (m) {
      reader.releaseLock();
      return m[1]! + m[2]!;
    }
  }
}

beforeAll(async () => {
  for (const d of [home, kiwiHome, bins, calls, join(repo, ".git"), join(forgotten, ".git")]) mkdirSync(d, { recursive: true });
  script(join(bins, "claude"), `if [ "$1" = "--version" ]; then echo '2.1.304 (Claude Code)'; exit 0; fi\nexec sleep 600`);
  script(join(bins, "tmux"), `t=$(mktemp '${root}/call.XXXXXX')\nprintf '%s\\n' "$@" > "$t"\nmv "$t" '${calls}/'\nexec '${TMUX ?? "false"}' "$@"`);
  script(join(root, "login-shell"), `echo __kiwi_login_path__\necho '${bins}:/usr/bin:/bin'`);
  writeFileSync(join(kiwiHome, "config.json"), JSON.stringify({ channels: {}, launchRoots: [repo] }));
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(root, "relay"), human: devHumanAuth() });
  relay = server.url.origin;
  person = await withExchangeKey(await generateIdentity("Ada Lovelace"));

  const held: { device: Identity | null; links: DeviceLink[]; machine?: typeof machine } = { device: null, links: [] };
  const app = createDeviceHost({
    relayUrl: () => relay,
    token: async () => "dev:ada",
    person: () => person,
    who: () => ({ name: person.name, pk: person.pk, xpk: person.xpk! }),
    device: () => held.device,
    saveDevice: (d) => void (held.device = d),
    links: () => held.links,
    saveLinks: (l) => void (held.links = l),
    channels: () => [],
    computer: (c) => void (held.machine = { pk: c.machinePk, xpk: c.machineXpk, label: c.label }),
    label: () => "studio",
    os: () => "macOS",
    wipe: () => {},
  });
  await app.poll();
  const login = Bun.spawn([process.execPath, MAIN_TS, "login", "--user", "ada", "--fingerprint", await personFingerprint(person.pk)], {
    cwd: root,
    env: { ...env(), KIWI_RELAY: relay },
    stdout: "pipe",
    stderr: "pipe",
  });
  let ask = await app.poll();
  for (const until = Date.now() + 20_000; !ask && Date.now() < until; ask = await app.poll()) await Bun.sleep(100);
  if (!ask) throw new Error("the computer never asked to be added");
  await app.answer(ask.id);
  const confirmed = await app.confirm(ask.id, await digitsFrom(login.stdout));
  if (!confirmed.ok) throw new Error("the app refused the computer's digits");
  if ((await login.exited) !== 0) throw new Error(`kiwi login failed: ${await new Response(login.stderr).text()}`);
  if (!held.machine) throw new Error("the app didn't certify the computer");
  machine = held.machine;
  const until = Date.now() + 20_000;
  while ((await machineOnline({ signer: person, person: person.pk, relay }, machine.pk)) !== true && Date.now() < until) await Bun.sleep(200);
});

afterAll(async () => {
  await stopDaemon(daemonSock(kiwiHome)).catch(() => {});
  await new HostedTmux(kiwiHome).kill();
  server?.stop(true);
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!TMUX)("starting an agent on one of your computers from another device (T394)", () => {
  test("the computer comes online for its person once kiwi login starts its daemon", async () => {
    expect(await machineOnline({ signer: person, person: person.pk, relay }, machine.pk)).toBe(true);
  });

  test("it lists the harnesses it can start, without bypass while its switch is off, and offers the folders added for it, not every git repo at home (#1303)", async () => {
    const harnesses = await harnessesOn({ signer: person, person: person.pk, relay }, machine);
    if (!harnesses.ok) throw new Error(harnesses.detail);
    const claude = harnesses.value.find((r) => r.harness === "claude");
    expect(claude).toMatchObject({ path: join(bins, "claude"), version: "2.1.304", start: true });
    expect(claude?.options?.permission).toContain("plan");
    expect(claude?.options?.permission).not.toContain("bypass");
    const folders = await foldersOn({ signer: person, person: person.pk, relay }, machine, "a".repeat(32));
    if (!folders.ok) throw new Error(folders.detail);
    expect(folders.value).toContain(repo);
    expect(folders.value).not.toContain(forgotten);
  });

  test("it starts Claude Code in that repo with the model, effort and permission mode asked for, in Channels' own tmux", async () => {
    const launched = await launchOn({ signer: person, person: person.pk, relay }, machine, {
      launch: "fromThePhone_0123456789",
      harness: "claude",
      folder: repo,
      code,
      relay,
      model: "sonnet",
      effort: "high",
      permission: "plan",
    });
    expect(launched).toMatchObject({ ok: true, launch: "fromThePhone_0123456789", place: "hosted" });
    const argv = openedFor("fromThePhone_0123456789");
    expect(argv.slice(argv.indexOf("-c"), argv.indexOf("-c") + 2)).toEqual(["-c", repo]);
    expect(argv.slice(-10)).toEqual(["--model", "sonnet", "--effort", "high", "--permission-mode", "plan", "--allowedTools", "Bash(kiwi join:*)", "--", expect.stringContaining(`kiwi join ${code}`)]);
  });

  test("bypass is refused before anything opens until that computer allows it, then reaches Claude Code", async () => {
    const before = opened().length;
    const refused = await launchOn({ signer: person, person: person.pk, relay }, machine, { launch: "bypassFromPhone_000001", harness: "claude", folder: repo, code, relay, permission: "bypass" });
    expect(refused).toEqual({ ok: false, why: "not-allowed", detail: NO_REMOTE_BYPASS });
    expect(opened().length).toBe(before);

    expect(kiwi(["launches", "bypass", "on"]).exitCode).toBe(0);
    const harnesses = await harnessesOn({ signer: person, person: person.pk, relay }, machine);
    expect(harnesses.ok && harnesses.value.find((r) => r.harness === "claude")?.options?.permission).toContain("bypass");
    const allowed = await launchOn({ signer: person, person: person.pk, relay }, machine, { launch: "bypassFromPhone_000002", harness: "claude", folder: repo, code, relay, permission: "bypass" });
    expect(allowed).toMatchObject({ ok: true, place: "hosted" });
    expect(openedFor("bypassFromPhone_000002")).toContain("bypassPermissions");
  });

  test("a folder it doesn't start agents in is refused, however it's spelled", async () => {
    const outside = join(root, "elsewhere");
    mkdirSync(outside, { recursive: true });
    for (const [n, folder] of [outside, join(repo, "..", "..", "..", "elsewhere"), forgotten].entries()) {
      const r = await launchOn({ signer: person, person: person.pk, relay }, machine, { launch: `outsideFromPhone_000${n}`, harness: "claude", folder, code, relay });
      expect(r).toEqual({ ok: false, why: "bad-request", detail: "that folder isn't one this computer starts agents in" });
    }
  });

  test("a third start in ten minutes goes through, and a fourth is refused before anything opens", async () => {
    expect(await launchOn({ signer: person, person: person.pk, relay }, machine, { launch: "thirdFromPhone_0000001", harness: "claude", folder: repo, code, relay })).toMatchObject({ ok: true });
    const before = opened().length;
    const fourth = await launchOn({ signer: person, person: person.pk, relay }, machine, { launch: "fourthFromPhone_000001", harness: "claude", folder: repo, code, relay });
    expect(fourth).toMatchObject({ ok: false, detail: "at most 3 agents are started from another computer every 10 minutes" });
    expect(opened().length).toBe(before);
  });
});
