import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { startLocalRelay } from "../../../scripts/local-relay.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "../eb-drive.ts";
import { firstChannel } from "../eb-first-run.ts";

const [appDir, out, kind, inputTool] = process.argv.slice(2);
if (!appDir || !out || (kind !== "kde" && kind !== "gnome")) {
  console.error("usage: bun audit.ts <test app folder> <out dir> kde|gnome [kwin-input]");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const here = import.meta.dir;
const root = mkdtempSync(join(tmpdir(), "kiwi-clip-"));
const drop = join(root, "kiwi-drop.png");
writeFileSync(drop, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mP8z8DwnxLMOKoBNQwAAMtpH/HNeV+SAAAAAElFTkSuQmCC", "base64"));
const readBack = join(root, "read.json");
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
type Rect = [number, number, number, number];
type Result = { check: string; ok: boolean; detail: unknown };
const results: Result[] = [];
const record = (check: string, ok: boolean, detail: unknown) => {
  results.push({ check, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${check}: ${JSON.stringify(detail)}`);
};

function lines(p: ChildProcessWithoutNullStreams, name: string): () => Promise<Record<string, unknown>> {
  const queue: Record<string, unknown>[] = [];
  const waiting: ((v: Record<string, unknown>) => void)[] = [];
  createInterface({ input: p.stdout }).on("line", (l) => {
    let v: Record<string, unknown>;
    try {
      v = JSON.parse(l) as Record<string, unknown>;
    } catch {
      console.log(`[${name}] ${l}`);
      return;
    }
    const w = waiting.shift();
    if (w) w(v);
    else queue.push(v);
  });
  createInterface({ input: p.stderr }).on("line", (l) => console.log(`[${name}] ${l}`));
  return () => {
    const v = queue.shift();
    return v ? Promise.resolve(v) : new Promise((r) => waiting.push(r));
  };
}

async function within<T>(what: string, ms: number, p: Promise<T>): Promise<T> {
  return Promise.race([p, later(ms).then(() => Promise.reject(new Error(`${what}: nothing in ${ms / 1000}s`)))]);
}

const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const exe = appExecutable(appDir);
const app = launch(exe, testEnv(root, join(root, "driver.sock"), `http://127.0.0.1:${port}`));
const env: NodeJS.ProcessEnv = { ...process.env, GDK_BACKEND: "wayland" };
delete env["DISPLAY"];
const helper = spawn("python3", [join(here, "helper.py"), readBack, drop], { env }) as ChildProcessWithoutNullStreams;
const fromHelper = lines(helper, "helper");
const desk = spawn("python3", [join(here, "desk.py"), kind === "kde" ? "kwin" : "gnome", inputTool ?? ""], { env: process.env }) as ChildProcessWithoutNullStreams;
const fromDesk = lines(desk, "desk");
const ask = async (req: Record<string, unknown>): Promise<unknown> => {
  desk.stdin.write(`${JSON.stringify(req)}\n`);
  const r = await within(`desk ${String(req["op"])}`, 30_000, fromDesk());
  if ("error" in r) throw new Error(`desk ${String(req["op"])}: ${String(r["error"])}`);
  return r["ok"];
};
const helperEvent = async (event: string, ms = 10_000): Promise<Record<string, unknown>> => {
  for (;;) {
    const e = await within(`helper ${event}`, ms, fromHelper());
    if (e["event"] === event) return e;
  }
};

let d: Driver | null = null;
try {
  await within("desk ready", 30_000, fromDesk());
  const ready = await helperEvent("ready", 30_000);
  const hr = ready["rects"] as Record<string, Rect>;
  console.log(`helper ready on ${String(ready["backend"])}: ${JSON.stringify(ready)}`);
  record("the helper runs as a native Wayland client", String(ready["backend"]).includes("Wayland"), ready["backend"]);
  d = await attach(join(root, "driver.sock"));
  const driver = d;
  await firstChannel(driver, 1);
  await until("the composer", 30_000, () => driver.evaluate(() => (document.querySelector('textarea[aria-label="Message"]') ? true : null), null, 2_000));
  const geo = (await ask({ op: "layout", windows: { "kiwi-helper": [0, 0, ...((ready["size"] as number[]) ?? [360, 160])], Channels: [420, 0, 1200, 800] } })) as Record<string, { f: Rect; c: Rect; focus: boolean; type?: number; x11?: boolean }>;
  console.log(`windows: ${JSON.stringify(geo)}`);
  const hw = geo["kiwi-helper"];
  const cw = geo["Channels"];
  if (!hw || !cw) throw new Error(`windows not found: ${JSON.stringify(Object.keys(geo))}`);
  record("no window is an X11 client", Object.values(geo).every((g) => !g.x11 && g.type !== 1), geo);
  const page = await driver.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, href: location.href }), null);
  const offX = cw.c[2] - page.w;
  const offY = cw.c[3] - page.h;
  console.log(`page ${JSON.stringify(page)}, offset in the window ${offX},${offY}`);
  const onPage = (r: Rect): [number, number] => [cw.c[0] + offX + r[0] + r[2] / 2, cw.c[1] + offY + r[1] + r[3] / 2];
  const onHelper = (name: string): [number, number] => {
    const r = hr[name];
    if (!r) throw new Error(`no helper widget ${name}`);
    return [hw.c[0] + r[0] + r[2] / 2, hw.c[1] + r[1] + r[3] / 2];
  };
  const rectOf = (selector: string) =>
    driver.evaluate((s: string) => {
      const r = document.querySelector(s)?.getBoundingClientRect();
      return r ? ([r.x, r.y, r.width, r.height] as [number, number, number, number]) : null;
    }, selector);
  const composer = 'textarea[aria-label="Message"]';
  const click = async (p: [number, number]) => void (await ask({ op: "click", x: p[0], y: p[1] }));
  const keys = async (...combo: string[]) => void (await ask({ op: "keys", combo }));
  const setComposer = (v: string) =>
    driver.evaluate((value: string) => {
      const el = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
      if (!el) return false;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }, v);
  const state = () =>
    driver.evaluate(
      () => ({
        value: document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.value ?? null,
        files: [...document.querySelectorAll('button[aria-label^="Remove "]')].map((b) => b.getAttribute("aria-label")),
        active: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName ?? null,
        href: location.href,
      }),
      null,
    );
  const read = async (): Promise<Record<string, unknown>> => {
    await click(onHelper("read"));
    const e = await helperEvent("read");
    return e;
  };
  const shot = (name: string) => ask({ op: "shot", path: join(out, `${kind}-${name}.png`) }).catch((e: Error) => console.log(e.message));

  const box = await rectOf(composer);
  if (!box) throw new Error("no composer rect");
  const at = onPage(box);
  await click(at);
  await later(400);
  let s = await state();
  record("a click on the composer focuses it (input reaches the app, the page offset is right)", s.active === "Message", { at, s });
  await shot("01-focused");

  await setComposer("");
  await click(onHelper("copy-text"));
  await helperEvent("copied-text");
  await later(300);
  await click(at);
  await later(300);
  await keys("ctrl", "v");
  await later(800);
  s = await state();
  record("text copied in another app pastes into the composer (Ctrl+V)", s.value === "kiwi pasted text", s);

  const before = s.files.length;
  await setComposer("");
  await click(onHelper("copy-image"));
  await helperEvent("copied-image");
  await later(300);
  await click(at);
  await later(300);
  await keys("ctrl", "v");
  await later(1500);
  s = await state();
  record("an image copied in another app pastes into the composer as an attachment", s.files.length > before, s);
  await shot("02-pasted");

  await setComposer("kiwi copied out");
  await click(at);
  await later(300);
  await keys("ctrl", "a");
  await keys("ctrl", "c");
  await later(400);
  let got = await read();
  record("text selected in the composer and copied (Ctrl+C) reaches another app", got["text"] === "kiwi copied out", got);
  await setComposer("");

  const copyButton = await driver.evaluate(() => {
    const b = document.querySelector('button[aria-label="Copy text"]');
    const g = b?.closest('[class*="group/b"]')?.getBoundingClientRect();
    return g ? ([g.x, g.y, g.width, g.height] as [number, number, number, number]) : null;
  }, null);
  if (copyButton) {
    await ask({ op: "hover", x: onPage(copyButton)[0], y: onPage(copyButton)[1] });
    await later(400);
    const button = await rectOf('button[aria-label="Copy text"]');
    if (button) {
      await click(onPage(button));
      await later(600);
      got = await read();
      record("a message's Copy text button (navigator.clipboard.writeText) reaches another app", typeof got["text"] === "string" && String(got["text"]).startsWith("Message 1:"), got);
    } else record("a message's Copy text button (navigator.clipboard.writeText) reaches another app", false, "no button rect after hover");
  } else record("a message's Copy text button (navigator.clipboard.writeText) reaches another app", false, "no message with a Copy text button");

  await driver.evaluate(() => {
    const b = document.createElement("button");
    b.id = "kiwi-audit-copy-image";
    b.textContent = "copy image";
    Object.assign(b.style, { position: "fixed", left: "8px", top: "8px", zIndex: "99999", width: "140px", height: "40px" });
    b.addEventListener("click", () => {
      const w = window as unknown as { kiwiAuditCopy?: string };
      w.kiwiAuditCopy = "pending";
      void (async () => {
        try {
          const c = document.createElement("canvas");
          c.width = 32;
          c.height = 24;
          const x = c.getContext("2d");
          if (x) {
            x.fillStyle = "#0a0";
            x.fillRect(0, 0, 32, 24);
          }
          const blob = await (await fetch(c.toDataURL("image/png"))).blob();
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          w.kiwiAuditCopy = "written";
        } catch (e) {
          w.kiwiAuditCopy = String(e);
        }
      })();
    });
    document.body.append(b);
    return true;
  }, null);
  const imgButton = await rectOf("#kiwi-audit-copy-image");
  if (imgButton) {
    await click(onPage(imgButton));
    await later(1200);
    const copied = await driver.evaluate(() => (window as unknown as { kiwiAuditCopy?: string }).kiwiAuditCopy ?? null, null);
    got = await read();
    record("an image copied as the annotator copies it (navigator.clipboard.write, image/png) reaches another app", Array.isArray(got["image"]), { page: copied, read: got });
  }
  await driver.evaluate(() => void document.getElementById("kiwi-audit-copy-image")?.remove(), null);

  s = await state();
  const filesBefore = s.files.length;
  await ask({ op: "drag", from: onHelper("drag"), to: at, steps: 30 });
  await later(1500);
  s = await state();
  record("a PNG dragged from another app onto the composer becomes an attachment", s.files.some((f) => f?.includes("kiwi-drop.png")) || s.files.length > filesBefore, s);
  await shot("03-dropped");

  const list = await rectOf("main") ?? [40, 120, 300, 200];
  const elsewhere = onPage([list[0], list[1], Math.min(list[2], 300), Math.min(list[3], 200)]);
  await ask({ op: "drag", from: onHelper("drag"), to: elsewhere, steps: 30 });
  await later(1500);
  s = await state();
  const alive = await driver.evaluate(() => location.href, null).then((h) => h, (e: Error) => `gone: ${e.message}`);
  record("a file dropped elsewhere in the window leaves the page where it was", alive.startsWith("views://internal/index.html"), { href: alive, s });
} catch (e) {
  record("the audit ran to the end", false, e instanceof Error ? e.message : String(e));
} finally {
  writeFileSync(join(out, `${kind}-results.json`), JSON.stringify(results, null, 2));
  helper.kill();
  desk.kill();
  d?.close();
  await stop(app).catch(() => undefined);
  relay.kill();
}
if (existsSync(readBack)) console.log(`last read: ${readFileSync(readBack, "utf8")}`);
console.log(`${results.filter((r) => !r.ok).length} of ${results.length} checks failed on ${kind}`);
