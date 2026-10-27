import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { firstChannel } from "./eb-first-run.ts";

const [appDir, results, kwinInput] = process.argv.slice(2);
if (!appDir || !results || !kwinInput || !process.env["WAYLAND_DISPLAY"] || process.env["DISPLAY"]) {
  console.error("usage (inside a Wayland-only KWin session): bun desktop/scripts/wayland-check.ts <test app folder> <results.json> <kwin-input>");
  process.exit(2);
}
const here = join(import.meta.dir, "wayland-check");
const root = mkdtempSync(join(tmpdir(), "kiwi-wayland-check-"));
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
type Rect = [number, number, number, number];
type Point = [number, number];
type Window = { c: Rect; x11: boolean };
const checks: { check: string; ok: boolean; detail: unknown }[] = [];
const record = (check: string, ok: boolean, detail: unknown, gap?: string) => {
  checks.push({ check, ok: ok || !!gap, detail: ok || !gap ? detail : { gap, detail } });
  console.log(`${ok ? "ok  " : gap ? "gap " : "FAIL"} ${check}: ${JSON.stringify(ok || !gap ? detail : { gap, detail })}`);
};
const step = async (check: string, fn: () => Promise<{ ok: boolean; detail: unknown }>, gap?: string) => {
  try {
    const r = await fn();
    record(check, r.ok, r.detail, gap);
  } catch (e) {
    record(check, false, `threw: ${e instanceof Error ? e.message : String(e)}`, gap);
  }
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

const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const helper = spawn("python3", [join(here, "helper.py"), join(root, "read.json"), join(root, "kiwi-drop.png")], { env: { ...process.env, GDK_BACKEND: "wayland" } }) as ChildProcessWithoutNullStreams;
const fromHelper = lines(helper, "helper");
const helperEvent = async (event: string): Promise<Record<string, unknown>> => {
  for (;;) {
    const e = await within(`the helper's ${event}`, 10_000, fromHelper());
    if (e["event"] === event) return e;
  }
};
const desk = spawn("python3", [join(here, "kwin.py"), kwinInput], { env: process.env }) as ChildProcessWithoutNullStreams;
const fromDesk = lines(desk, "kwin");
const ask = async (req: Record<string, unknown>): Promise<unknown> => {
  desk.stdin.write(`${JSON.stringify(req)}\n`);
  const r = await within(`KWin's ${String(req["op"])}`, 30_000, fromDesk());
  if ("error" in r) throw new Error(`KWin's ${String(req["op"])}: ${String(r["error"])}`);
  return r["ok"];
};

let d: Driver | null = null;
const app = launch(appExecutable(appDir), testEnv(root, join(root, "driver.sock"), `http://127.0.0.1:${port}`));
try {
  await within("KWin's fake input", 30_000, fromDesk());
  const ready = await within("the helper window", 30_000, helperEvent("ready"));
  const widgets = ready["rects"] as Record<string, Rect>;
  const size = (ready["size"] as number[] | undefined) ?? [360, 160];
  record("the helper app is a native Wayland client", String(ready["backend"]) === "GdkWaylandDisplay", ready["backend"]);
  d = await attach(join(root, "driver.sock"));
  const driver = d;
  await firstChannel(driver, 1);
  await until("the composer", 30_000, () => driver.evaluate(() => (document.querySelector('textarea[aria-label="Message"]') ? true : null), null, 2_000));
  const geo = (await ask({ op: "layout", windows: { "kiwi-helper": [0, 100, size[0], size[1]], Channels: [420, 100, 1200, 800] } })) as Record<string, Window>;
  const hw = geo["kiwi-helper"];
  const cw = geo["Channels"];
  if (!hw || !cw) throw new Error(`windows: ${JSON.stringify(geo)}`);
  record(
    "no window is an X11 client",
    Object.values(geo).every((g) => !g.x11),
    geo,
  );
  const page = await driver.evaluate(() => ({ w: innerWidth, h: innerHeight }), null);
  const onPage = (r: Rect): Point => [cw.c[0] + cw.c[2] - page.w + r[0] + r[2] / 2, cw.c[1] + cw.c[3] - page.h + r[1] + r[3] / 2];
  const onHelper = (name: string): Point => {
    const r = widgets[name];
    if (!r) throw new Error(`no helper widget ${name}`);
    return [hw.c[0] + r[0] + r[2] / 2, hw.c[1] + r[1] + r[3] / 2];
  };
  const rectOf = (selector: string) =>
    driver.evaluate((s: string) => {
      const r = document.querySelector(s)?.getBoundingClientRect();
      return r ? ([r.x, r.y, r.width, r.height] as [number, number, number, number]) : null;
    }, selector);
  const click = async (p: Point) => void (await ask({ op: "click", x: p[0], y: p[1] }));
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
    return helperEvent("read");
  };
  const box = await rectOf('textarea[aria-label="Message"]');
  if (!box) throw new Error("no composer");
  const composer = onPage(box);

  await step("a click on the composer focuses it", async () => {
    await click(composer);
    await later(400);
    const s = await state();
    return { ok: s.active === "Message", detail: s };
  });

  await step("text copied in another app pastes into the composer", async () => {
    await setComposer("");
    await click(onHelper("copy-text"));
    await helperEvent("copied-text");
    await click(composer);
    await later(300);
    await keys("ctrl", "v");
    await later(800);
    const s = await state();
    return { ok: s.value === "kiwi pasted text", detail: s };
  });

  await step("an image copied in another app pastes into the composer as an attachment (T896)", async () => {
    await setComposer("");
    const before = (await state()).files.length;
    await driver.evaluate(() => {
      const w = window as unknown as { kiwiCheckPastes?: unknown[] };
      w.kiwiCheckPastes = [];
      window.addEventListener(
        "paste",
        (e) => w.kiwiCheckPastes?.push({ types: [...(e.clipboardData?.types ?? [])], files: e.clipboardData?.files.length ?? null, items: e.clipboardData?.items.length ?? null }),
        { capture: true, once: true },
      );
      return true;
    }, null);
    await click(onHelper("copy-image"));
    await helperEvent("copied-image");
    await click(composer);
    await later(300);
    await keys("ctrl", "v");
    await later(1500);
    const s = await state();
    const pastes = await driver.evaluate(() => (window as unknown as { kiwiCheckPastes?: unknown[] }).kiwiCheckPastes ?? null, null);
    return { ok: s.files.length === before + 1 && s.files.includes("Remove pasted.png"), detail: { before, s, pastes } };
  });

  await step("text copied from the composer (Ctrl+C) pastes in another app", async () => {
    await setComposer("kiwi copied out");
    await click(composer);
    await later(300);
    await keys("ctrl", "a");
    await keys("ctrl", "c");
    await later(400);
    const got = await read();
    await setComposer("");
    return { ok: got["text"] === "kiwi copied out", detail: got };
  });

  await step(
    "a message's Copy text button copies for another app",
    async () => {
      const message = await driver.evaluate(() => {
        const g = document.querySelector('button[aria-label="Copy text"]')?.closest('article, [class*="group/b"]')?.getBoundingClientRect();
        return g ? ([g.x, g.y, g.width, g.height] as [number, number, number, number]) : null;
      }, null);
      if (!message) return { ok: false, detail: "no message with a Copy text button" };
      const [x, y] = onPage(message);
      await ask({ op: "hover", x, y });
      await later(400);
      const button = await rectOf('button[aria-label="Copy text"]');
      if (!button) return { ok: false, detail: "no Copy text button under the pointer" };
      await click(onPage(button));
      await later(600);
      const got = await read();
      return { ok: String(got["text"] ?? "").startsWith("Message 1:"), detail: got };
    },
    "KWin's fake input gives the page no user activation, so WebKit refuses navigator.clipboard writes; with a real gesture they reach the clipboard (Livewire Kitchen, T152)",
  );

  await step(
    "an image the page copies (navigator.clipboard.write, image/png) pastes in another app",
    async () => {
      await driver.evaluate(() => {
        const b = document.createElement("button");
        b.id = "kiwi-check-copy-image";
        Object.assign(b.style, { position: "fixed", left: "8px", top: "8px", zIndex: "99999", width: "140px", height: "40px" });
        b.addEventListener("click", () => {
          const c = document.createElement("canvas");
          c.width = 32;
          c.height = 24;
          const png = new Promise<Blob>((ok, no) => c.toBlob((blob) => (blob ? ok(blob) : no(new Error("no PNG"))), "image/png"));
          void navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
        });
        document.body.append(b);
        return true;
      }, null);
      const r = await rectOf("#kiwi-check-copy-image");
      if (!r) return { ok: false, detail: "no copy button" };
      await click(onPage(r));
      await later(1200);
      await driver.evaluate(() => void document.getElementById("kiwi-check-copy-image")?.remove(), null);
      const got = await read();
      return { ok: Array.isArray(got["image"]), detail: got };
    },
    "KWin's fake input gives the page no user activation, so WebKit refuses navigator.clipboard writes; with a real gesture they reach the clipboard (Livewire Kitchen, T152)",
  );

  await step("a PNG dragged from another app onto the composer is attached (T895)", async () => {
    const before = (await state()).files.length;
    await driver.evaluate(() => {
      const w = window as unknown as { kiwiCheckDrops?: unknown[] };
      w.kiwiCheckDrops = [];
      window.addEventListener(
        "drop",
        (e) => w.kiwiCheckDrops?.push({ types: [...(e.dataTransfer?.types ?? [])], files: e.dataTransfer?.files.length ?? null, uris: e.dataTransfer?.getData("text/uri-list") ?? null }),
        { capture: true, once: true },
      );
      return true;
    }, null);
    await ask({ op: "drag", from: onHelper("drag"), to: composer });
    await later(1500);
    const s = await state();
    const page = await driver.evaluate(() => ({ platform: navigator.platform, agent: navigator.userAgent, drops: (window as unknown as { kiwiCheckDrops?: unknown[] }).kiwiCheckDrops ?? null }), null);
    return { ok: s.files.includes("Remove kiwi-drop.png") && s.files.length === before + 1, detail: { before, s, page } };
  });

  await step("a file dropped elsewhere in the window leaves the page where it was", async () => {
    await ask({ op: "drag", from: onHelper("drag"), to: onPage([page.w / 2 - 100, page.h / 3 - 50, 200, 100]) });
    await later(2000);
    const href = await driver.evaluate(() => location.href, null, 5_000);
    return { ok: href.startsWith("views://internal/index.html") && app.exitCode === null, detail: { href, exit: app.exitCode } };
  });

  await step("the app asks KWin for client-side decorations", async () => {
    const probe = spawnSync("bash", [join(import.meta.dir, "eb-wayland-start.sh"), join(appDir, "bin", "electrobun-launcher")], { env: process.env, encoding: "utf8", timeout: 45_000 });
    const output = `${probe.stdout}${probe.stderr}`.trim();
    return { ok: probe.status === 0 && output.includes(".request_mode(1)"), detail: output };
  });
} catch (e) {
  record("the check set up", false, e instanceof Error ? e.message : String(e));
} finally {
  writeFileSync(results, JSON.stringify(checks, null, 2));
  helper.kill();
  desk.kill();
  d?.close();
  await stop(app).catch(() => undefined);
  relay.kill();
}
const failed = checks.filter((c) => !c.ok);
console.log(`${failed.length} of ${checks.length} checks failed`);
process.exit(failed.length ? 1 : 0);
