import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const [out, kind, inputTool] = process.argv.slice(2);
const variant = process.env["KIWI_AUDIT_VARIANT"] ?? "sandboxed";
if (!out || (kind !== "kde" && kind !== "gnome")) {
  console.error("usage: bun plain-audit.ts <out dir> kde|gnome [kwin-input]");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const name = `${kind}-plain-${variant}`;
const here = import.meta.dir;
const root = mkdtempSync(join(tmpdir(), "kiwi-plain-"));
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
type Rect = [number, number, number, number];
type Point = [number, number];
const results: { check: string; ok: boolean; detail: unknown }[] = [];
const record = (check: string, ok: boolean, detail: unknown) => {
  results.push({ check, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${check}: ${JSON.stringify(detail)}`);
};

function lines(p: ChildProcessWithoutNullStreams, tag: string): () => Promise<Record<string, unknown>> {
  const queue: Record<string, unknown>[] = [];
  const waiting: ((v: Record<string, unknown>) => void)[] = [];
  createInterface({ input: p.stdout }).on("line", (l) => {
    let v: Record<string, unknown>;
    try {
      v = JSON.parse(l) as Record<string, unknown>;
    } catch {
      console.log(`[${tag}] ${l}`);
      return;
    }
    const w = waiting.shift();
    if (w) w(v);
    else queue.push(v);
  });
  createInterface({ input: p.stderr }).on("line", (l) => {
    if (!l.includes("AT-SPI")) console.log(`[${tag}] ${l}`);
  });
  return () => {
    const v = queue.shift();
    return v ? Promise.resolve(v) : new Promise((r) => waiting.push(r));
  };
}
const within = <T>(what: string, ms: number, p: Promise<T>): Promise<T> => Promise.race([p, later(ms).then(() => Promise.reject(new Error(`${what}: nothing in ${ms / 1000}s`)))]);

const env: NodeJS.ProcessEnv = { ...process.env, GDK_BACKEND: "wayland" };
delete env["DISPLAY"];
const helper = spawn("python3", [join(here, "helper.py"), join(root, "read.json"), join(root, "kiwi-drop.png")], { env }) as ChildProcessWithoutNullStreams;
const fromHelper = lines(helper, "helper");
const helperEvent = async (event: string): Promise<Record<string, unknown>> => {
  for (;;) {
    const e = await within(`helper ${event}`, 10_000, fromHelper());
    if (e["event"] === event) return e;
  }
};
const desk = spawn("python3", [join(here, "desk.py"), kind === "kde" ? "kwin" : "gnome", inputTool ?? ""], { env: process.env }) as ChildProcessWithoutNullStreams;
const fromDesk = lines(desk, "desk");
const ask = async (req: Record<string, unknown>): Promise<unknown> => {
  desk.stdin.write(`${JSON.stringify(req)}\n`);
  const r = await within(`desk ${String(req["op"])}`, 30_000, fromDesk());
  if ("error" in r) throw new Error(String(r["error"]));
  return r["ok"];
};
const page = spawn("python3", [join(here, "plain.py"), variant], { env }) as ChildProcessWithoutNullStreams;
const fromPage = lines(page, "plain");
const evaluate = async <A, R>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R> => {
  page.stdin.write(`${JSON.stringify({ fn: fn.toString(), arg: JSON.stringify(arg ?? null) })}\n`);
  const r = await within("plain page", 15_000, fromPage());
  if ("error" in r) throw new Error(String(r["error"]));
  return r["ok"] as R;
};

try {
  await within("desk ready", 30_000, fromDesk());
  const ready = await within("helper ready", 30_000, helperEvent("ready"));
  const pageReady = await within("plain page ready", 30_000, fromPage());
  console.log(`plain page: ${JSON.stringify(pageReady)}`);
  const hr = ready["rects"] as Record<string, Rect>;
  const size = (ready["size"] as number[] | undefined) ?? [360, 160];
  const geo = (await ask({ op: "layout", windows: { "kiwi-helper": [0, 100, size[0], size[1]], "plain-webkit": [420, 100, 1200, 800] } })) as Record<string, { f: Rect; c: Rect }>;
  const hg = geo["kiwi-helper"];
  const pg = geo["plain-webkit"];
  if (!hg || !pg) throw new Error(`windows: ${JSON.stringify(geo)}`);
  const hw = kind === "gnome" ? hg.f : hg.c;
  const pw = kind === "gnome" ? pg.f : pg.c;
  const inner = await evaluate(() => [innerWidth, innerHeight], null);
  const offX = pw[2] - (inner[0] ?? 0);
  const offY = pw[3] - (inner[1] ?? 0);
  const box = await evaluate(() => {
    const r = document.querySelector("textarea")?.getBoundingClientRect();
    return r ? [r.x, r.y, r.width, r.height] : null;
  }, null);
  if (!box) throw new Error("no textarea");
  const at: Point = [pw[0] + offX + (box[0] ?? 0) + (box[2] ?? 0) / 2, pw[1] + offY + (box[1] ?? 0) + (box[3] ?? 0) / 2];
  const onHelper = (w: string): Point => {
    const r = hr[w];
    if (!r) throw new Error(`no helper widget ${w}`);
    return [hw[0] + r[0] + r[2] / 2, hw[1] + r[1] + r[3] / 2];
  };
  const click = async (p: Point) => void (await ask({ op: "click", x: p[0], y: p[1] }));
  const events = () =>
    evaluate(() => {
      const w = window as unknown as { kiwiAuditEvents: { t: string; files: string[] | null; items: string[] | null }[] };
      const e = w.kiwiAuditEvents;
      w.kiwiAuditEvents = [];
      return e;
    }, null);

  await click(onHelper("copy-text"));
  await helperEvent("copied-text");
  await click(at);
  await later(300);
  await events();
  await ask({ op: "keys", combo: ["ctrl", "v"] });
  await later(800);
  const value = await evaluate(() => document.querySelector("textarea")?.value ?? null, null);
  record("plain WebKitGTK: text pastes", value === "kiwi pasted text", { value, events: await events() });

  await click(onHelper("copy-image"));
  await helperEvent("copied-image");
  await click(at);
  await later(300);
  await events();
  await ask({ op: "keys", combo: ["ctrl", "v"] });
  await later(1200);
  const pasted = await events();
  const paste = pasted.find((e) => e.t === "paste");
  record("plain WebKitGTK: a pasted image is in the paste event", !!paste && ((paste.files?.length ?? 0) > 0 || (paste.items ?? []).some((i) => i.startsWith("file:image"))), pasted);

  await events();
  await ask({ op: "drag", from: onHelper("drag"), to: at, steps: 30 });
  await later(1500);
  const dropped = await events();
  const drop = dropped.find((e) => e.t === "drop");
  record("plain WebKitGTK: a dropped PNG is in the drop event's files", !!drop && (drop.files ?? []).some((f) => f.startsWith("kiwi-drop.png")), dropped.filter((e) => e.t !== "dragover"));
} catch (e) {
  record("the plain audit set up", false, e instanceof Error ? e.message : String(e));
} finally {
  writeFileSync(join(out, `${name}-results.json`), JSON.stringify(results, null, 2));
  for (const p of [helper, desk, page]) p.kill();
}
console.log(`${results.filter((r) => !r.ok).length} of ${results.length} checks failed on ${name}`);
