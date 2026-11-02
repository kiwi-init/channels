import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Launched } from "@kiwi/core/terminals.ts";
import { daemonLaunch, daemonListening, daemonSock, stopDaemon, type PairedMachine } from "../src/daemon.ts";
import { HostedTmux } from "../src/daemon/hosted-tmux.ts";
import { saveMachine } from "../src/machine.ts";
import { startRelay } from "../src/relay/bun.ts";
import { pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";
import { inviteLine, kiwiJoin } from "@kiwi/app/join-line.ts";

const STARTS = Math.max(1, Number(process.env.KIWI_STARTS) || 9);
const BURST = 3;
const IN_MS = 60_000;
const EVERY_MS = 250;
const MAIN_TS = join(import.meta.dir, "..", "src", "cli", "main.ts");
const TMUX = process.env.KIWI_TMUX || Bun.which("tmux");
const root = realpathSync(mkdtempSync(join(tmpdir(), "kiwi-starts-")));
const home = join(root, "home");
const kiwiHome = join(root, "kiwi");
const bins = join(root, "bins");
const repo = join(home, "code", "payments");
const doomed = join(root, "app-bundle");
const prevHome = process.env.KIWI_HOME;

type Step = "started" | "asked" | "in";

interface Kind {
  harness: "claude" | "codex" | "kimi";
  nick?: string;
  unknown?: true;
}

interface Start {
  kind: Kind;
  launch: string;
  at: number;
  steps: Partial<Record<Step, number>>;
  handle?: string;
  failed?: string;
}

const ALL_KINDS: Kind[] = [{ harness: "claude", nick: "nova" }, { harness: "codex" }, { harness: "kimi", nick: "kim" }, { harness: "kimi", nick: "anon", unknown: true }];
const ONLY = process.env.KIWI_STARTS_ONLY?.split(",") ?? [];
const KINDS = ALL_KINDS.filter((k) => !ONLY.length || ONLY.includes(k.harness));

function script(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

const JOIN = `cmd=$(printf '%s' "$prompt" | sed -n 's/.*until it prints "joined": \\(kiwi join .*\\)\\. If it asks for your model.*/\\1/p')
[ -n "$cmd" ] || { echo "no kiwi join line in the prompt"; exit 9; }
eval "$cmd --model harness-model"
sleep 600`;
const VERSION = `if [ "$1" = "--version" ]; then echo '9.9.9'; exit 0; fi`;

let server: ReturnType<typeof startRelay> | undefined;
let s: OwnerSetup;
let daemon: Bun.Subprocess | undefined;
const hosted = new HostedTmux(kiwiHome);
const starts: Start[] = [];

const daemonEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !/^(CLAUDE|CODEX|KIWI_|TMUX)/.test(key)) env[key] = value;
  return {
    ...env,
    HOME: home,
    KIWI_HOME: kiwiHome,
    KIWI_RELAY: server!.url.origin,
    KIWI_NO_HOOKS: "1",
    SHELL: "/bin/sh",
    CLAUDE_CONFIG_DIR: join(root, "claude"),
    ...(TMUX ? { KIWI_TMUX: TMUX } : {}),
  };
};

async function screenOf(pane: string): Promise<string> {
  const st = hosted.state();
  return st ? (await hosted.tmux(st, ["capture-pane", "-p", "-J", "-S", "-", "-t", pane])).stdout : "";
}

async function deadOf(pane: string): Promise<string | null> {
  const st = hosted.state();
  if (!st) return null;
  const r = await hosted.tmux(st, ["display-message", "-p", "-t", pane, "#{pane_dead} #{pane_dead_status}"]);
  const [dead, code] = r.stdout.trim().split(" ");
  return dead === "1" ? (code ?? "?") : null;
}

const lastLines = (text: string): string =>
  text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .slice(-4)
    .join(" | ");

async function follow(start: Start, launched: Launched): Promise<void> {
  if (!launched.ok) {
    start.failed = `not started: ${launched.detail}`;
    return;
  }
  start.steps.started = Date.now() - start.at;
  const pane = launched.placed.pane;
  for (const end = Date.now() + IN_MS; ; await Bun.sleep(EVERY_MS)) {
    const screen = await screenOf(pane);
    const asked = /asked to join as ([a-z0-9-]+)/.exec(screen);
    if (asked && start.steps.asked === undefined) start.steps.asked = Date.now() - start.at;
    const joined = /joined "[^"]*" as ([a-z0-9-]+)/.exec(screen);
    if (joined) {
      const member = (await s.ownerCh.members()).find((m) => m.name === joined[1]);
      if (member) {
        start.handle = member.name;
        start.steps.in = Date.now() - start.at;
        if (start.kind.nick && member.display !== start.kind.nick) start.failed = `in as ${member.name}, but shown as ${member.display ?? "its handle"}, not ${start.kind.nick}`;
        return;
      }
    }
    const dead = await deadOf(pane);
    if (dead !== null) {
      start.failed = `${start.kind.harness} exited ${dead} ${start.steps.asked === undefined ? "before it asked" : "after it asked"}: ${lastLines(await screenOf(pane))}`;
      return;
    }
    if (Date.now() > end) {
      start.failed = `${start.steps.asked === undefined ? "never asked to join" : "asked, but never let in"} within ${IN_MS / 1000}s: ${lastLines(screen)}`;
      return;
    }
  }
}

async function launchOne(kind: Kind, n: number): Promise<Start> {
  const start: Start = { kind, launch: `harness_${String(n).padStart(4, "0")}_${kind.harness}${kind.unknown ? "_unknown" : ""}`, at: Date.now(), steps: {} };
  const launched = await daemonLaunch(
    { harness: kind.harness, folder: repo, code: s.code, relay: server!.url.origin, launch: start.launch, ...(kind.nick ? { nick: kind.nick } : {}) },
    daemonSock(kiwiHome),
  ).catch((err: unknown): Launched => ({ ok: false, why: "failed", detail: err instanceof Error ? err.message : String(err) }));
  await follow(start, launched);
  return start;
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

function report(): string {
  const all = starts.length;
  const inside = starts.filter((x) => x.steps.in !== undefined && !x.failed).length;
  const lines = [`starts that got all the way in: ${inside} of ${all}`];
  for (const step of ["started", "asked", "in"] as const) {
    const took = starts.map((x) => x.steps[step]).filter((v): v is number => v !== undefined);
    if (took.length) lines.push(`  ${step}: ${took.length} of ${all}, median ${secs(median(took))}, slowest ${secs(Math.max(...took))}`);
  }
  for (const x of starts.filter((y) => y.failed))
    lines.push(`  FAILED ${x.launch} (${x.kind.unknown ? "a harness kiwi can't recognise" : x.kind.harness}${x.kind.nick ? `, nick ${x.kind.nick}` : ""}): ${x.failed}`);
  try {
    lines.push(
      "launch.log:",
      ...readFileSync(join(kiwiHome, "launch.log"), "utf8")
        .trim()
        .split("\n")
        .map((l) => `  ${l}`),
    );
  } catch {
    // No launch.log means the daemon never got as far as starting anything, which the lines above already say.
  }
  return lines.join("\n");
}

beforeAll(async () => {
  for (const d of [home, kiwiHome, bins, doomed, join(root, "claude"), join(repo, ".git")]) mkdirSync(d, { recursive: true });
  script(join(bins, "kiwi"), `exec '${process.execPath}' '${MAIN_TS}' "$@"`);
  script(join(bins, "claude"), `${VERSION}\nexport CLAUDECODE=1 CLAUDE_CODE_SESSION_ID="claude-$$-$(date +%s)"\neval "prompt=\\\${$#}"\n${JOIN}`);
  script(join(bins, "codex"), `${VERSION}\nexport CODEX_THREAD_ID="codex-$$-$(date +%s)"\neval "prompt=\\\${$#}"\n${JOIN}`);
  copyFileSync("/bin/bash", join(bins, "kimi-code"));
  chmodSync(join(bins, "kimi-code"), 0o755);
  writeFileSync(
    join(bins, "kimi-code.sh"),
    `echo "Welcome to Kimi Code. No session yet: one will be created on your first message"\nprintf '> '\nIFS= read -r prompt\nexport TERM=dumb NO_COLOR=1\n${JOIN}\n`,
  );
  script(
    join(bins, "kimi"),
    `${VERSION}\ncase "$KIWI_LAUNCH" in *_unknown) exec /bin/sh '${join(bins, "kimi-code.sh")}' "$@" ;; esac\nexec '${join(bins, "kimi-code")}' '${join(bins, "kimi-code.sh")}' "$@"`,
  );
  script(join(bins, "gemini"), `${VERSION}\necho "gemini: not signed in"\nexit 3`);
  writeFileSync(join(home, ".profile"), `export PATH="${bins}:$PATH"\n`);
  writeFileSync(join(kiwiHome, "config.json"), JSON.stringify({ channels: {} }));
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(root, "relay") });
  s = await setupChannel(server.url.origin);
  const pc = await pairComputer(s.person, "harness-mac");
  process.env.KIWI_HOME = kiwiHome;
  const paired: PairedMachine = { identity: pc.machine, label: "harness-mac", relay: server.url.origin, cert: pc.cert, person: { pk: s.person.pk, xpk: s.person.xpk!, name: "owner" } };
  saveMachine(paired);
  await s.ownerCh.delegate({ pk: pc.machine.pk, xpk: pc.machine.xpk! }, s.person.pk);
  daemon = Bun.spawn([process.execPath, MAIN_TS, "daemon"], { cwd: doomed, env: daemonEnv(), stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  for (const end = Date.now() + 20_000; ; await Bun.sleep(100)) {
    if (
      await daemonListening(daemonSock(kiwiHome)).then(
        () => true,
        () => false,
      )
    )
      break;
    if (Date.now() > end) throw new Error("the daemon never came up");
  }
  rmSync(doomed, { recursive: true, force: true });
});

afterAll(async () => {
  console.log(report());
  if (process.env.KIWI_STARTS_REPORT) writeFileSync(process.env.KIWI_STARTS_REPORT, `${report()}\n`);
  await stopDaemon(daemonSock(kiwiHome)).catch(() => {});
  daemon?.kill();
  await hosted.kill();
  server?.stop(true);
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!TMUX)(`Add agent, end to end: ${STARTS} starts from a daemon whose folder was deleted`, () => {
  test(
    "every start gets all the way in: started, asked, let in by this computer, shown under its nickname",
    async () => {
      const one = Math.max(0, STARTS - BURST);
      for (let n = 0; n < one; n++) starts.push(await launchOne(KINDS[n % KINDS.length]!, n));
      const burst = Math.min(BURST, STARTS);
      starts.push(...(await Promise.all(Array.from({ length: burst }, (_, i) => launchOne(KINDS[(one + i) % KINDS.length]!, one + i)))));
      expect(starts.filter((x) => x.failed).map((x) => `${x.launch}: ${x.failed}`)).toEqual([]);
      expect(starts.filter((x) => x.steps.in !== undefined)).toHaveLength(STARTS);
    },
    STARTS * IN_MS + 60_000,
  );

  test(
    "a Claude session started before kiwi was on its PATH pastes Add agent's line and gets in, told to run kiwi by its full path",
    async () => {
      const app = join(home, ".kiwi", "bin", "kiwi");
      mkdirSync(join(app, ".."), { recursive: true });
      copyFileSync(join(bins, "kiwi"), app);
      chmodSync(app, 0o755);
      const env = { ...daemonEnv(), PATH: "/usr/bin:/bin", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "pasted-before-the-app", KIWI_MODEL: "harness-model" };
      const old = Bun.spawnSync(["sh", "-c", `kiwi ${kiwiJoin(server!.url.origin, s.code)}`], { cwd: repo, env, stdout: "pipe", stderr: "pipe" });
      expect(old.exitCode).toBe(127);
      const agent = Bun.spawn(["sh", "-c", inviteLine(server!.url.origin, s.code, { nick: "pasted" })], { cwd: repo, env, stdout: "pipe", stderr: "pipe" });
      const [out, err] = await Promise.all([new Response(agent.stdout).text(), new Response(agent.stderr).text(), agent.exited]);
      const joined = /joined "[^"]*" as ([a-z0-9-]+)/.exec(err);
      expect(joined?.[1]).toBeDefined();
      expect((await s.ownerCh.members()).find((m) => m.name === joined![1])).toMatchObject({ display: "pasted" });
      expect(out).toContain(`\`${app} status\``);
    },
    IN_MS,
  );

  test("a harness that dies as it starts is counted as a failure with its words, not as in", async () => {
    const start: Start = { kind: { harness: "claude" }, launch: "harness_dies_gemini", at: Date.now(), steps: {} };
    const launched = await daemonLaunch({ harness: "gemini", folder: repo, code: s.code, relay: server!.url.origin, launch: start.launch }, daemonSock(kiwiHome));
    await follow(start, launched);
    expect(start.steps.in).toBeUndefined();
    expect(start.failed).toContain("gemini: not signed in");
  });
});
