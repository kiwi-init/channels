import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { firstChannel, sendMessage } from "./eb-first-run.ts";

const [appPath, outDir, session] = process.argv.slice(2);
if (!appPath || !outDir || (session !== "x11" && session !== "wayland")) {
  console.error("usage: bun desktop/scripts/eb-flicker-probe.ts <test build> <out dir> x11|wayland");
  process.exit(2);
}
const windows = Number(process.env["FLICKER_WINDOWS"] ?? "3");
const seconds = Number(process.env["FLICKER_SECONDS"] ?? "30");
mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
const step = (what: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${what}`);
setTimeout(
  () => {
    step("deadline reached, exiting");
    process.exit(3);
  },
  Number(process.env["FLICKER_DEADLINE"] ?? "2400") * 1000,
).unref();

const sh = (args: string[]): string => {
  const r = spawnSync(args[0]!, args.slice(1), { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
};

const HOOKS = () => {
  const log: Record<string, unknown>[] = [];
  let frame = 0;
  const id = (el: Element | null): string => {
    if (!el) return "none";
    const seq = el instanceof HTMLElement && el.dataset["seq"] ? `#${el.dataset["seq"]}` : "";
    return `${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(".")}${seq}`;
  };
  const top = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
  if (top?.set && top.get) {
    const get = top.get;
    const set = top.set;
    Object.defineProperty(Element.prototype, "scrollTop", {
      configurable: true,
      get() {
        return get.call(this);
      },
      set(v: number) {
        const before = get.call(this);
        set.call(this, v);
        log.push({
          t: performance.now(),
          wall: Date.now(),
          frame,
          kind: "scrollTop",
          el: id(this as Element),
          before,
          after: get.call(this),
          caller: (new Error().stack ?? "").split("\n").slice(2, 6).join(" < "),
        });
      },
    });
  }
  const Native = window.ResizeObserver;
  window.ResizeObserver = class extends Native {
    constructor(cb: ResizeObserverCallback) {
      super((entries, obs) => {
        log.push({
          t: performance.now(),
          wall: Date.now(),
          frame,
          kind: "resize",
          targets: entries.map((e) => `${id(e.target)} ${e.contentRect.width.toFixed(2)}x${e.contentRect.height.toFixed(2)}`),
        });
        cb(entries, obs);
      });
    }
  };
  const rect = (el: Element | null) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [Number(r.top.toFixed(3)), Number(r.height.toFixed(3))];
  };
  const sample = () => {
    frame++;
    const feed = document.querySelector<HTMLElement>(".feed");
    if (feed) {
      const rows = [...feed.querySelectorAll<HTMLElement>("[data-seq]")].filter((r) => {
        const b = r.getBoundingClientRect();
        return b.bottom > 0 && b.top < innerHeight;
      });
      log.push({
        t: performance.now(),
        wall: Date.now(),
        frame,
        kind: "frame",
        scrollTop: feed.scrollTop,
        scrollHeight: feed.scrollHeight,
        clientHeight: feed.clientHeight,
        rows: Object.fromEntries(rows.map((r) => [r.dataset["seq"], rect(r)])),
        composer: rect(document.querySelector(".compose")),
        shell: rect(document.querySelector(".rail")),
      });
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  Object.assign(window, { flickerLog: log });
};

const lines = (topic: string) =>
  Array.from({ length: 28 }, (_, i) => `${i + 1}. ${topic}: checked the ${["build", "relay", "store", "feed", "composer", "rail", "tray"][i % 7]} path again and it holds steady under load.`).join(
    "\n",
  );
const FIXTURE = [
  `Long report on the release checks:\n${lines("release")}`,
  `Long report on the store checks:\n${lines("store")}`,
  "Thanks, I'll wait for the key before tagging.",
  "The store checks are green again.",
  "Holding the release until the step is done.",
];

const recorder = (region: { x: number; y: number; w: number; h: number }, file: string): ChildProcess => {
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  if (session === "x11")
    return spawn(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-f",
        "x11grab",
        "-framerate",
        "60",
        "-video_size",
        `${even(region.w)}x${even(region.h)}`,
        "-i",
        `${process.env["DISPLAY"]}+${region.x},${region.y}`,
        "-c:v",
        "libx264rgb",
        "-qp",
        "0",
        "-preset",
        "ultrafast",
        file,
      ],
      { stdio: ["ignore", "ignore", openSync(file.replace(/\.mkv$/, "-rec.log"), "w")] },
    );
  return spawn("wf-recorder", ["-y", "-g", `${region.x},${region.y} ${even(region.w)}x${even(region.h)}`, "-r", "60", "-c", "libx264rgb", "-p", "crf=0", "-p", "qp=0", "-f", file], {
    stdio: ["ignore", "ignore", openSync(file.replace(/\.mkv$/, "-rec.log"), "w")],
  });
};

const finish = async (rec: ChildProcess, wake: () => Promise<unknown>): Promise<number | null> => {
  if (rec.exitCode === null && rec.signalCode === null) {
    const exit = new Promise((r) => rec.once("exit", () => r(true)));
    rec.kill("SIGINT");
    await Bun.sleep(300);
    if (rec.exitCode === null) await wake();
    const exited = await Promise.race([exit, Bun.sleep(30_000).then(() => false)]);
    if (!exited) rec.kill("SIGKILL");
  }
  return rec.exitCode;
};

const poke = () =>
  new Promise<boolean>((done) => {
    const feed = document.querySelector<HTMLElement>(".feed");
    if (!feed) return done(false);
    feed.style.outline = "2px solid #f0f";
    feed.style.outlineOffset = "-2px";
    let left = 6;
    const tick = () => {
      if (--left > 0) return void requestAnimationFrame(tick);
      feed.style.outline = "";
      feed.style.outlineOffset = "";
      done(true);
    };
    requestAnimationFrame(tick);
  });

const drain = async (d: Driver): Promise<Record<string, unknown>[]> => {
  const all: Record<string, unknown>[] = [];
  for (;;) {
    const part = (await d.evaluate(() => (Reflect.get(window, "flickerLog") as unknown[]).splice(0, 300), null)) as Record<string, unknown>[];
    all.push(...part);
    if (part.length < 300) return all;
  }
};

const origin = (): { x: number; y: number } => {
  if (session === "x11") {
    const win = sh(["xdotool", "search", "--onlyvisible", "--class", "^Channels"]).split("\n")[0] ?? "";
    const g = Object.fromEntries(
      sh(["xdotool", "getwindowgeometry", "--shell", win])
        .split("\n")
        .map((l) => l.split("=") as [string, string]),
    );
    return { x: Number(g["X"] ?? 0), y: Number(g["Y"] ?? 0) };
  }
  const tree = JSON.parse(sh(["swaymsg", "-t", "get_tree"]) || "{}") as { nodes?: unknown[] };
  const find = (n: unknown): { x: number; y: number } | null => {
    if (!n || typeof n !== "object") return null;
    const node = n as { app_id?: string; rect?: { x: number; y: number }; nodes?: unknown[]; floating_nodes?: unknown[] };
    if (node.app_id && /channels/i.test(node.app_id) && node.rect) return { x: node.rect.x, y: node.rect.y };
    for (const c of [...(node.nodes ?? []), ...(node.floating_nodes ?? [])]) {
      const f = find(c);
      if (f) return f;
    }
    return null;
  };
  return find(tree) ?? { x: 0, y: 0 };
};

const root = mkdtempSync(join(tmpdir(), "kiwi-flicker-"));
const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const env = testEnv(root, join(root, "driver.sock"), `http://127.0.0.1:${port}`);
const report: Record<string, unknown>[] = [];
const app = launch(appExecutable(appPath), env);
try {
  const d: Driver = await attach(join(root, "driver.sock"));
  try {
    step("attached");
    await until("the window on screen", 60_000, async () => ((await d.main("window")) as { visible?: unknown }).visible === true || null);
    step("window visible");
    await firstChannel(d, 0);
    step("first channel open");
    for (const text of FIXTURE) await until(`fixture message sent`, 60_000, () => d.evaluate(sendMessage, { text, shows: text.split("\n")[0]! }, 2_000).then((ok) => (ok ? true : null)));
    step("fixture sent");
    await d.evaluate(() => document.fonts.ready.then(() => true), null);
    await d.evaluate(HOOKS, null);
    const env0 = await d.evaluate(() => ({ dpr: devicePixelRatio, inner: `${innerWidth}x${innerHeight}`, ua: navigator.userAgent }), null);
    console.log(`session ${session}; page ${JSON.stringify(env0)}`);
    for (const scroll of ["bottom", "up"]) {
      for (const focus of ["off", "on"]) {
        const state = `${scroll}-focus${focus}`;
        step(`${state}: set state`);
        await d.evaluate(
          ({ scroll: s, focus: f }) => {
            const feed = document.querySelector<HTMLElement>(".feed");
            if (feed && s === "up") {
              feed.dispatchEvent(new WheelEvent("wheel", { deltaY: -400, bubbles: true }));
              feed.scrollTop = Math.max(0, feed.scrollTop - 2 * feed.clientHeight);
            }
            if (feed && s === "bottom") feed.scrollTop = feed.scrollHeight;
            const area = document.querySelector<HTMLTextAreaElement>(".main .composer textarea");
            if (f === "on") area?.focus();
            else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            const style = document.getElementById("flicker-caret") ?? Object.assign(document.createElement("style"), { id: "flicker-caret" });
            style.textContent = "* { caret-color: transparent !important; }";
            document.head.append(style);
            return true;
          },
          { scroll, focus },
        );
        await Bun.sleep(2000);
        step(`${state}: read box`);
        const box = await d.evaluate(() => {
          const b = document.querySelector(".feed")?.getBoundingClientRect();
          return b ? { x: b.x + 72, y: b.y, w: b.width - 72, h: b.height, dpr: devicePixelRatio } : null;
        }, null);
        if (!box) throw new Error("no feed on screen");
        const at = origin();
        const region = {
          x: Math.round(at.x + box.x * (session === "x11" ? box.dpr : 1)),
          y: Math.round(at.y + box.y * (session === "x11" ? box.dpr : 1)),
          w: Math.round(box.w * (session === "x11" ? box.dpr : 1)),
          h: Math.round(box.h * (session === "x11" ? box.dpr : 1)),
        };
        for (let w = 1; w <= windows + 1; w++) {
          const control = w === windows + 1;
          const file = join(outDir, `${state}-${control ? "control" : `w${w}`}.mkv`);
          step(`${state} ${control ? "control" : `w${w}`}: drop old trace`);
          await drain(d);
          step(`${state} ${control ? "control" : `w${w}`}: record ${JSON.stringify(region)}`);
          const rec = recorder(region, file);
          const started = Date.now();
          await Bun.sleep(1500);
          const pulses: { at: number; frames: number }[] = [];
          if (control) {
            for (const frames of [1, 1, 1, 1, 1, 2, 2, 2, 2, 2]) {
              pulses.push({ at: (Date.now() - started) / 1000, frames });
              await d.evaluate(
                (n: number) =>
                  new Promise<boolean>((done) => {
                    const list = document.querySelector<HTMLElement>(".feed > *");
                    if (!list) return done(false);
                    requestAnimationFrame(() => {
                      list.style.transform = "translateY(1px)";
                      let left = n;
                      const tick = () => {
                        if (--left > 0) return void requestAnimationFrame(tick);
                        list.style.transform = "";
                        done(true);
                      };
                      requestAnimationFrame(tick);
                    });
                  }),
                frames,
              );
              await Bun.sleep(1000);
            }
          } else await Bun.sleep(seconds * 1000);
          const stopAt = (Date.now() - started) / 1000;
          const code = await finish(rec, () => d.evaluate(poke, null));
          step(`${state} ${control ? "control" : `w${w}`}: recorder exited ${code}; dump trace`);
          const trace = await drain(d);
          writeFileSync(file.replace(/\.mkv$/, "-trace.json"), JSON.stringify(trace));
          const writes = trace.filter((e) => e["kind"] === "scrollTop" && Math.abs(Number(e["after"]) - Number(e["before"])) > 0.001);
          const resizes = trace.filter((e) => e["kind"] === "resize");
          const samples = trace.filter((e) => e["kind"] === "frame");
          let moved = 0;
          for (let i = 1; i < samples.length; i++) {
            const a = samples[i - 1]!["rows"] as Record<string, number[]>;
            const b = samples[i]!["rows"] as Record<string, number[]>;
            if (Object.keys(b).some((k) => a[k] && Math.abs(a[k]![0]! - b[k]![0]!) > 0.01)) moved++;
          }
          const row = {
            session,
            state,
            window: control ? "control" : w,
            region,
            recordStart: started,
            recorderExit: code,
            stopAt,
            rafSamples: samples.length,
            geometryMoves: moved,
            scrollTopWritesThatMoved: writes.length,
            resizeCallbacks: resizes.length,
            pulses,
          };
          report.push(row);
          console.log(JSON.stringify(row));
        }
      }
    }
  } finally {
    d.close();
  }
} finally {
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 1));
  await stop(app);
  relay.kill();
  rmSync(root, { recursive: true, force: true });
}
