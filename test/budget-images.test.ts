import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packRow } from "../src/cache-row.ts";
import { Channel } from "../src/client.ts";
import { loadConfig, loadIdentity } from "../src/config.ts";
import type { Message } from "../src/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";
import { sum, trafficProxy, type Traffic } from "./traffic.ts";

setDefaultTimeout(300_000);

const BUDGET = {
  downShare: 0.1,
  cacheShare: 0.1,
  appShare: 0.1,
} as const;

const IMAGE_BYTES = 200 * 1024;
const MESSAGES = 3;
const AGENTS = 3;

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-budget-img-${tag}-`));
  made.push(d);
  return d;
};
const dataDir = scratch("relay");
let server: ReturnType<typeof startRelay> | undefined;
let proxy: ReturnType<typeof trafficProxy> | undefined;

function spawn(home: string, args: string[]) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: proxy!.url, KIWI_NO_HOOKS: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function ok(home: string, ...args: string[]): Promise<string> {
  const p = spawn(home, args);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  if (code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${code}: ${err}`);
  return out;
}

async function until(pred: () => boolean | Promise<boolean>, label: string, ms = 60_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

const cacheFile = (home: string, roomId: string) => join(home, "cache", `${roomId}.jsonl`);
const cacheSize = (home: string, roomId: string) => (existsSync(cacheFile(home, roomId)) ? statSync(cacheFile(home, roomId)).size : 0);
const cached = (home: string, roomId: string, seq: number) =>
  existsSync(cacheFile(home, roomId)) &&
  readFileSync(cacheFile(home, roomId), "utf8")
    .split("\n")
    .some((l) => l.startsWith(`{`) && (JSON.parse(l) as { seq: number }).seq === seq);

interface Run {
  traffic: Traffic;
  cache: number;
  app: number;
  show: Traffic;
  same: boolean;
}

async function scenario(mode: "inline" | "refs"): Promise<Run> {
  const owner = scratch(`${mode}-owner`);
  const code = /join code: (\S+)/.exec(await ok(owner, "create", `img-${mode}`, "--as", "lead", "--open"))![1]!;
  const agents = Array.from({ length: AGENTS }, (_, i) => scratch(`${mode}-a${i}`));
  for (const [i, home] of agents.entries()) {
    const joining = spawn(home, ["join", code, "--as", `dev${i}`]);
    let listed = "";
    await until(async () => {
      listed = await ok(owner, "--as", "human", "requests");
      return /\d{3}-\d{3}/.test(listed);
    }, "request");
    await ok(owner, "--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes");
    expect(await joining.exited).toBe(0);
  }
  if (mode === "refs") await ok(owner, "--as", "human", "images", "refs");

  const prior = process.env.KIWI_HOME;
  process.env.KIWI_HOME = owner;
  const cfg = Object.values(loadConfig().channels)[0]!;
  const identity = await loadIdentity("human", cfg.roomId);
  if (prior === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prior;
  const roomId = cfg.roomId;

  const files = Array.from({ length: MESSAGES }, (_, i) => {
    const path = join(owner, `shot${i}.png`);
    writeFileSync(path, crypto.getRandomValues(new Uint8Array(IMAGE_BYTES)));
    return path;
  });

  const app = new Channel(cfg, proxy!.url, identity);
  const seen: Message[] = [];
  let lastSeen = Date.now();
  let ready = false;
  const stop = new AbortController();
  const streaming = app.stream(
    0,
    (m) => {
      seen.push(m);
      lastSeen = Date.now();
    },
    { signal: stop.signal, onReady: () => (ready = true) },
  );
  const listeners = agents.map((home) => spawn(home, ["listen"]));
  const started = Date.now();
  await until(() => ready && proxy!.stats.sockets >= AGENTS + 1 && Date.now() - started > 3000 && Date.now() - lastSeen > 1500, "listeners");
  const before = agents.map((home) => cacheSize(home, roomId));

  proxy!.reset();
  const seqs: number[] = [];
  for (const [i, file] of files.entries()) seqs.push(Number(/sent #(\d+)/.exec(await ok(owner, "--as", "lead", "send", `shot ${i}`, "--image", file))![1]));
  const last = seqs.at(-1)!;
  await until(() => seen.some((m) => m.seq === last) && agents.every((home) => cached(home, roomId, last)), "delivery");
  await Bun.sleep(300);
  const traffic = proxy!.reset();
  const cache = agents.reduce((n, home, i) => n + cacheSize(home, roomId) - before[i]!, 0);

  for (const l of listeners) l.kill();
  stop.abort();
  await streaming.catch(() => {});
  await Promise.all(listeners.map((l) => l.exited));

  const key = cfg.keys[String(cfg.epoch)]!;
  let appBytes = 0;
  for (const m of seen.filter((x) => seqs.includes(x.seq))) appBytes += JSON.stringify(await packRow(key, roomId, cfg.epoch, m)).length;

  await Bun.sleep(100);
  proxy!.reset();
  await ok(agents[0]!, "show", String(seqs[0]));
  await Bun.sleep(100);
  const show = proxy!.reset();
  const saved = join(agents[0]!, "downloads", roomId, `#${seqs[0]}-shot0.png`);
  const same = existsSync(saved) && Buffer.compare(readFileSync(saved), readFileSync(files[0]!)) === 0;

  console.log(
    `${mode}: ${MESSAGES} messages with a ${IMAGE_BYTES / 1024}KB image, ${AGENTS} agents listening + the app: ` +
      `${traffic.bytesDown} B down, ${traffic.bytesUp} B up, ${traffic.http} http ${JSON.stringify(traffic.routes)}, ${sum(traffic.framesDown)} frames down; ` +
      `CLI caches +${cache} B (${AGENTS} agents); app history ${appBytes} B; kiwi show: ${show.bytesDown} B down ${JSON.stringify(show.routes)}, identical image: ${same}`,
  );
  return { traffic, cache, app: appBytes, show, same };
}

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  proxy = trafficProxy(server.url.origin);
});

afterAll(() => {
  proxy?.stop();
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe("images by reference: a channel with three agents listening and the app open", () => {
  let inline: Run;
  let refs: Run;
  beforeAll(async () => {
    inline = await scenario("inline");
    refs = await scenario("refs");
  });

  test("listeners download a fraction of the bytes", () => {
    console.log(`bytes down: ${inline.traffic.bytesDown} inline -> ${refs.traffic.bytesDown} by reference`);
    expect(refs.traffic.bytesDown).toBeLessThanOrEqual(inline.traffic.bytesDown * BUDGET.downShare);
  });

  test("the CLI cache and the app's history keep references, not bytes", () => {
    console.log(`CLI cache: ${inline.cache} B inline -> ${refs.cache} B by reference; app history: ${inline.app} B -> ${refs.app} B`);
    expect(refs.cache).toBeLessThanOrEqual(inline.cache * BUDGET.cacheShare);
    expect(refs.app).toBeLessThanOrEqual(inline.app * BUDGET.appShare);
  });

  test("kiwi show still yields the identical image", () => {
    expect(inline.same).toBe(true);
    expect(refs.same).toBe(true);
    expect(refs.show.routes["GET /blobs/:pk"]).toBe(1);
  });
});
