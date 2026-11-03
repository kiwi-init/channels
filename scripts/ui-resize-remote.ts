import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { personFingerprint } from "@kiwi/core/fingerprint.ts";
import type { DeviceLink } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import type { TermEvent } from "../desktop/src/bridge.ts";
import { createDeviceHost } from "../desktop/src/devices.ts";
import { machineOnline } from "../desktop/src/remote.ts";
import { remoteClose, remoteKeys, remoteSize, termRemote } from "../desktop/src/remote-terms.ts";
import { daemonSock, stopDaemon } from "../src/daemon.ts";
import { HostedTmux } from "../src/daemon/hosted-tmux.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const SECONDS = Number(flag("--seconds") ?? "30");
const REDRAW_KB = Number(flag("--redraw-kb") ?? "400");
if (!Bun.which("tmux")) throw new Error("this harness runs the other computer's shell in tmux: install tmux");

const MAIN_TS = join(import.meta.dir, "..", "src", "cli", "main.ts");
const root = realpathSync(mkdtempSync(join(tmpdir(), "kiwi-resize-remote-")));
const home = join(root, "home");
const kiwiHome = join(root, "kiwi");
const redraw = join(root, "redraw.ts");
for (const d of [home, kiwiHome]) mkdirSync(d, { recursive: true });
writeFileSync(join(kiwiHome, "config.json"), JSON.stringify({ channels: {} }));
writeFileSync(
  redraw,
  `const kb = ${REDRAW_KB};
const line = (i: number, cols: number) => ("\\x1b[38;5;" + (i % 200 + 16) + "m" + ("history " + i + " ").repeat(cols)).slice(0, cols + 12) + "\\x1b[0m";
const draw = () => {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const out = ["\\x1b[?2026h\\x1b[H\\x1b[2J\\x1b[3J"];
  let size = 0;
  for (let i = 0; size < kb * 1024; i++) {
    const l = line(i, cols);
    out.push(l, "\\r\\n");
    size += l.length + 2;
  }
  out.push("\\x1b[" + rows + ";1H\\x1b[7m " + cols + "x" + rows + " redrawn \\x1b[0m\\x1b[?2026l");
  process.stdout.write(out.join(""));
};
process.on("SIGWINCH", draw);
process.stdin.setRawMode?.(true);
process.stdin.on("data", (d) => {
  if (d.includes(3)) process.exit(0);
  process.stdout.write("\\r\\nkey " + JSON.stringify(String(d)) + "\\r\\n");
});
draw();
`,
);

const env = (): Record<string, string> => ({ ...(process.env as Record<string, string>), HOME: home, KIWI_HOME: kiwiHome, KIWI_NO_HOOKS: "1", SHELL: "/bin/sh" });

const fails: string[] = [];
const expect = (ok: boolean, what: string): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

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

const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(root, "relay"), human: devHumanAuth() });
const relay = server.url.origin;
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const ui = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

try {
  const person: Identity = await withExchangeKey(await generateIdentity("Ada Lovelace"));
  const held: { device: Identity | null; links: DeviceLink[]; machine?: { pk: string; xpk: string } } = { device: null, links: [] };
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
    computer: (c) => void (held.machine = { pk: c.machinePk, xpk: c.machineXpk }),
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
  if (!ask) throw new Error("the other computer never asked to be added");
  await app.answer(ask.id);
  if (!(await app.confirm(ask.id, await digitsFrom(login.stdout))).ok) throw new Error("the app refused the other computer's digits");
  if ((await login.exited) !== 0) throw new Error(`kiwi login failed: ${await new Response(login.stderr).text()}`);
  const machine = held.machine;
  if (!machine) throw new Error("the app didn't certify the other computer");
  const asker = { signer: person, person: person.pk, relay };
  for (const until = Date.now() + 20_000; (await machineOnline(asker, machine.pk)) !== true && Date.now() < until;) await Bun.sleep(200);
  expect((await machineOnline(asker, machine.pk)) === true, "the other computer's daemon is online through the relay");

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let term: string | null = null;
  let realPane: string | null = null;
  let opens = 0;
  let seen = "";
  let fresh = "";
  let sizes = 0;
  const pending = new Map<string, string>();
  let flushing = false;
  const flush = async (): Promise<void> => {
    if (flushing || !pending.size) return;
    flushing = true;
    const batch = [...pending];
    pending.clear();
    await page.evaluate((b) => b.forEach(([t, text]) => (window as unknown as { kiwiHarnessOut(t: string, text: string): void }).kiwiHarnessOut(t, text)), batch).catch(() => {});
    flushing = false;
    if (pending.size) setTimeout(() => void flush(), 0);
  };
  const emit = (e: TermEvent): void => {
    if ("out" in e) {
      if (e.term === term) {
        seen = (seen + e.out).slice(-200_000);
        fresh = (fresh + e.out).slice(-200_000);
      }
      pending.set(e.term, (pending.get(e.term) ?? "") + e.out);
      void flush();
    } else void page.evaluate((t) => (window as unknown as { kiwiHarnessEnded(t: string): void }).kiwiHarnessEnded(t), e.term).catch(() => {});
  };
  await page.exposeFunction("kiwiPipeOpen", async (want: string | null, cols: number, rows: number) => {
    const r = await termRemote(asker, machine, realPane ?? "new", cols, rows, emit);
    if (!r.ok) return { error: r.detail };
    opens++;
    term = r.term;
    realPane = r.pane ?? realPane;
    return { term: r.term, screen: { cols: r.cols, rows: r.rows, seed: r.seed, dead: r.dead, pane: want ?? "%4" } };
  });
  await page.exposeFunction("kiwiPipeKeys", (t: string, text: string) => void remoteKeys(t, text));
  await page.exposeFunction("kiwiPipeSize", (t: string, cols: number, rows: number) => {
    if (t === term) sizes++;
    remoteSize(t, cols, rows);
  });
  await page.exposeFunction("kiwiPipeClose", (t: string) => void remoteClose(t));
  await page.addInitScript(() => {
    type Watch = { out(t: string): void; ended(): void };
    type Screen = { cols: number; rows: number; seed: string; dead: boolean; pane: string };
    const watches = new Map<string, Watch>();
    const early = new Map<string, string>();
    const w = window as unknown as {
      kiwiPipeOpen(want: string | null, cols: number, rows: number): Promise<{ term: string; screen: Screen } | { error: string }>;
      kiwiPipeKeys(t: string, text: string): Promise<void>;
      kiwiPipeSize(t: string, c: number, r: number): Promise<void>;
      kiwiPipeClose(t: string): Promise<void>;
      kiwiHarnessOut(t: string, text: string): void;
      kiwiHarnessEnded(t: string): void;
      kiwiHarnessShell: unknown;
    };
    w.kiwiHarnessOut = (t, text) => {
      const watch = watches.get(t);
      if (watch) watch.out(text);
      else early.set(t, (early.get(t) ?? "") + text);
    };
    w.kiwiHarnessEnded = (t) => watches.get(t)?.ended();
    w.kiwiHarnessShell = {
      open: async (want: string | null, cols: number, rows: number, watch: Watch) => {
        const r = await w.kiwiPipeOpen(want, cols, rows);
        if ("error" in r) return r;
        const t = r.term;
        watches.set(t, watch);
        queueMicrotask(() => {
          const held = early.get(t);
          early.delete(t);
          if (held) watch.out(held);
        });
        return {
          screen: r.screen,
          link: {
            keys: (text: string) => void w.kiwiPipeKeys(t, text),
            size: (c: number, rows2: number) => void w.kiwiPipeSize(t, c, rows2),
            close: () => {
              watches.delete(t);
              void w.kiwiPipeClose(t);
            },
          },
        };
      },
    };
  });
  await page.goto(`http://127.0.0.1:${ui.port}/?shot=terminal-mine&theme=dark`);
  await page.locator(".term canvas").first().waitFor();
  await page.getByRole("tab", { name: /arch/ }).click();
  for (const until = Date.now() + 15_000; !term && Date.now() < until;) await Bun.sleep(100);
  expect(term !== null, "the drawer's remote tab opened a real shell on the other computer");
  await Bun.sleep(1_000);
  remoteKeys(term, `exec ${process.execPath} ${redraw}\r`);
  for (const until = Date.now() + 15_000; !seen.includes("redrawn") && Date.now() < until;) await Bun.sleep(100);
  expect(seen.includes("redrawn"), `the other computer's program redraws ${REDRAW_KB} KB into the drawer`);

  const alive = async (): Promise<number | null> => {
    const t = Date.now();
    const ok = await Promise.race([page.evaluate(() => 1).then(() => true), Bun.sleep(5_000).then(() => false)]);
    return ok ? Date.now() - t : null;
  };
  let worst = 0;
  let hung = false;
  const grip = await page.locator(".term-grip").boundingBox();
  if (!grip) throw new Error("the drawer has no grip");
  const gx = grip.x + grip.width / 2;
  const end = Date.now() + SECONDS * 1_000;
  for (let round = 0; Date.now() < end && !hung; round++) {
    const vw = 700 + (round % 5) * 180;
    const vh = 420 + (round % 4) * 160;
    await page.setViewportSize({ width: vw, height: vh });
    const g = await page.locator(".term-grip").boundingBox();
    const gy = (g?.y ?? grip.y) + 4;
    await page.mouse.move(Math.min(gx, vw - 20), gy);
    await page.mouse.down();
    for (let y = gy; y < vh - 20; y += 9) await page.mouse.move(Math.min(gx, vw - 20), y);
    for (let y = vh - 20; y > 60; y -= 13) await page.mouse.move(Math.min(gx, vw - 20), y);
    await page.mouse.up();
    const ms = await alive();
    if (ms === null) hung = true;
    else worst = Math.max(worst, ms);
  }
  expect(!hung, `${SECONDS} s of grip drags and window resizes leave the page answering (slowest answer ${worst} ms)`);
  expect(sizes > 3, `the drawer sent its sizes to the other computer (${sizes}, over ${opens} opens)`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await Bun.sleep(1_500);
  fresh = "";
  remoteKeys(term, "z");
  for (const until = Date.now() + 15_000; !fresh.includes('key "z"') && Date.now() < until;) await Bun.sleep(100);
  expect(fresh.includes('key "z"'), "after the storm, the shell on the other computer still answers its keys");
  fresh = "";
  const typed = Date.now();
  await page.locator(".term canvas").first().click();
  await page
    .locator(".term canvas")
    .first()
    .evaluate((c) => c.parentElement?.focus());
  await page.keyboard.type("ok");
  for (const until = Date.now() + 15_000; !fresh.includes('key "') && Date.now() < until;) await Bun.sleep(100);
  expect(fresh.includes('key "'), `typing in the drawer reaches the other computer and its answer comes back (${Date.now() - typed} ms)`);
  expect((await page.getByText("The terminal stopped drawing").count()) === 0, "the drawer never gave up on the terminal");
  expect(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
} finally {
  await browser.close().catch(() => {});
  ui.stop(true);
  await stopDaemon(daemonSock(kiwiHome)).catch(() => {});
  await new HostedTmux(kiwiHome).kill().catch(() => {});
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
}
if (fails.length) {
  console.log(`\n${fails.length} failed`);
  process.exit(1);
}
