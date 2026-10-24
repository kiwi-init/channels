import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Reply = { id: number; ok: boolean; value?: unknown; error?: unknown };
type Seat = { code?: string };
type HostAsk = { type: string; id: number; entry?: Seat; code?: string };

const USAGE = "usage: bun desktop/scripts/package-probe.ts BUN KIWI_JS KEYS_JS";
const BODY = "sent from the package";
const WAIT_MS = 20_000;

async function drive(keysJs: string, relay: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-probe-keys-"));
  const worker = new Worker(keysJs);
  const seats: Seat[] = [];
  const waiting = new Map<number, { answer: (r: Reply) => void; fail: (why: string) => void }>();
  const say = (m: object) => worker.postMessage(m);
  worker.addEventListener("message", (e: MessageEvent) => {
    const d = e.data as { from: string; m?: HostAsk; data?: Reply };
    if (d.from === "host" && d.m) {
      const m = d.m;
      if (m.type === "flushed") return;
      if (m.type === "save" && m.entry) {
        const at = seats.findIndex((s) => s.code === m.entry?.code);
        if (at >= 0) seats[at] = m.entry;
        else seats.push(m.entry);
      }
      if (m.type === "forget") seats.splice(0, seats.length, ...seats.filter((s) => s.code !== m.code));
      say({ to: "host", m: { type: "done", id: m.id } });
      if (m.type === "save" || m.type === "forget") say({ to: "host", m: { type: "seats", seats, person: null } });
      return;
    }
    if (d.from === "port" && d.data && "id" in d.data) waiting.get(d.data.id)?.answer(d.data);
  });
  worker.addEventListener("error", (e) => {
    for (const w of waiting.values()) w.fail(`the keys worker threw: ${e.message}`);
  });
  let n = 0;
  const ask = <T>(data: object): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++n;
      const timer = setTimeout(() => reject(new Error(`no answer to ${JSON.stringify(data)} in ${WAIT_MS / 1000} s`)), WAIT_MS);
      waiting.set(id, {
        answer: (r) => {
          clearTimeout(timer);
          if (r.ok) resolve(r.value as T);
          else reject(new Error(JSON.stringify(r.error)));
        },
        fail: (why) => {
          clearTimeout(timer);
          reject(new Error(why));
        },
      });
      say({ to: "port", port: 1, data: { id, ...data } });
    });
  say({ to: "host", m: { type: "init", relay, dir, seats: [], person: null } });
  say({ to: "host", m: { type: "port" }, port: 1 });
  try {
    const made = await ask<{ code: string }>({ op: "create", name: "probe", token: null, me: { name: "Probe" } });
    const seq = await ask<number>({ op: "call", code: made.code, name: "send", args: [BODY] });
    const read = await ask<{ messages: { seq: number; body: string }[] }>({ op: "call", code: made.code, name: "history", args: [0] });
    const back = read.messages.filter((m) => m.body === BODY).map((m) => m.seq);
    if (back.join() !== String(seq)) throw new Error(`sent as #${seq}, read back as ${JSON.stringify(back)}`);
    if (seats.filter((s) => s.code === made.code).length !== 1) throw new Error("the channel's seat wasn't handed to the app to keep");
    return `made a channel, sent #${seq} and read it back, and handed its seat to the app`;
  } finally {
    worker.terminate();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(null) });
  const port = probe.port;
  await probe.stop(true);
  if (!port) throw new Error("no free port");
  return port;
}

async function probe(bun: string, kiwiJs: string, keysJs: string): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "kiwi-probe-home-"));
  const data = join(home, "relay");
  const port = await freePort();
  const env = { ...process.env, KIWI_HOME: home };
  const relay = Bun.spawn([bun, kiwiJs, "relay", "--port", String(port), "--hostname", "127.0.0.1", "--data", data, "--no-web"], { env, stdout: "pipe", stderr: "pipe" });
  try {
    const version = (await new Response(Bun.spawn([bun, kiwiJs, "version"], { env, stdout: "pipe" }).stdout).text()).trim();
    const url = `http://127.0.0.1:${port}`;
    const until = Date.now() + WAIT_MS;
    while (
      !(await fetch(`${url}/v1/config`).then(
        (r) => r.ok,
        () => false,
      ))
    ) {
      if (Date.now() > until || relay.exitCode !== null) throw new Error(`the package's kiwi relay didn't start: ${(await new Response(relay.stderr).text()).trim()}`);
      await Bun.sleep(100);
    }
    const driven = Bun.spawn([bun, import.meta.path, "--drive", keysJs, url], { env, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(driven.stdout).text(), new Response(driven.stderr).text(), driven.exited]);
    if (code !== 0) throw new Error(`the package's keys worker failed: ${(err || out).trim()}`);
    console.log(`package-probe: kiwi ${version} on bun ${(await new Response(Bun.spawn([bun, "--version"], { stdout: "pipe" }).stdout).text()).trim()}: ${out.trim()}`);
  } finally {
    relay.kill();
    await relay.exited;
    rmSync(home, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
if (args[0] === "--drive") {
  const [, keysJs, relay] = args;
  if (!keysJs || !relay) throw new Error(USAGE);
  console.log(await drive(keysJs, relay));
} else {
  const [bun, kiwiJs, keysJs] = args;
  if (!bun || !kiwiJs || !keysJs) throw new Error(USAGE);
  await probe(bun, kiwiJs, keysJs);
}
