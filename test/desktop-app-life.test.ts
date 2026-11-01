import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { appMenu, menuAction, shortcutAction, textStepOf, trayItems, type AppMenuItem } from "../desktop/src/app-menus.ts";
import { claimInstance, handoffFor, LOCK_FILE, readHandoff, SOCKET_FILE, type Handoff, type Instance } from "../desktop/src/single-instance.ts";
import { slept, watchWake, type WakeClock } from "../desktop/src/wake.ts";

const dirs: string[] = [];
const held: Instance[] = [];
const fresh = (): string => {
  const d = fs.mkdtempSync(path.join(tmpdir(), "si-"));
  dirs.push(d);
  return path.join(d, "data");
};

afterEach(() => {
  for (const i of held.splice(0)) if (i.kind === "first") i.release();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const claim = async (dir: string, handoff: Handoff, got: Handoff[] = [], waitMs = 500): Promise<Instance> => {
  const i = await claimInstance({ dir, handoff, scheme: "kiwi", onHandoff: (h) => got.push(h), waitMs });
  held.push(i);
  return i;
};

describe("one Channels per data folder, taken before the store opens (T438)", () => {
  test("the first start holds the lock and listens; the folder and socket are the user's alone", async () => {
    const dir = fresh();
    const first = await claim(dir, { kind: "show" });
    expect(first).toMatchObject({ kind: "first", listening: true });
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(dir, SOCKET_FILE)).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.join(dir, LOCK_FILE)).mode & 0o777).toBe(0o600);
  });

  test("a data folder that already exists is closed to other users too", async () => {
    const dir = fresh();
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    fs.chmodSync(dir, 0o755);
    await claim(dir, { kind: "show" });
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });

  test("a second start hands its kiwi:// link to the first and is told to go", async () => {
    const dir = fresh();
    const got: Handoff[] = [];
    await claim(dir, { kind: "show" }, got);
    const second = await claim(dir, { kind: "link", url: "kiwi://join/abc" });
    expect(second).toEqual({ kind: "second", delivered: true });
    expect(got).toEqual([{ kind: "link", url: "kiwi://join/abc" }]);
  });

  test("a second start without a link asks the first to show its window", async () => {
    const dir = fresh();
    const got: Handoff[] = [];
    await claim(dir, { kind: "show" }, got);
    expect(await claim(dir, { kind: "show" })).toEqual({ kind: "second", delivered: true });
    expect(got).toEqual([{ kind: "show" }]);
  });

  test("two first runs at once: exactly one opens the store", async () => {
    const dir = fresh();
    const both = await Promise.all([claim(dir, { kind: "show" }, [], 1500), claim(dir, { kind: "show" }, [], 1500)]);
    expect(both.map((i) => i.kind).sort()).toEqual(["first", "second"]);
  });

  test("once the first quits, the next start is first again, over a stale socket file", async () => {
    const dir = fresh();
    const first = await claim(dir, { kind: "show" });
    if (first.kind === "first") first.release();
    fs.writeFileSync(path.join(dir, SOCKET_FILE), "stale");
    expect(await claim(dir, { kind: "show" })).toMatchObject({ kind: "first", listening: true });
  });

  test("a lock held by a process that died is free again: the kernel drops it", async () => {
    const dir = fresh();
    const script = `import { claimInstance } from ${JSON.stringify(path.resolve(import.meta.dir, "../desktop/src/single-instance.ts"))};
      const i = await claimInstance({ dir: ${JSON.stringify(dir)}, handoff: { kind: "show" }, scheme: "kiwi", onHandoff: () => {} });
      console.log(i.kind); process.exit(0);`;
    const run = Bun.spawnSync(["bun", "-e", script]);
    expect(run.stdout.toString().trim()).toBe("first");
    expect(await claim(dir, { kind: "show" })).toMatchObject({ kind: "first" });
  });

  test("the lock isn't inherited: a child left running doesn't keep it", async () => {
    const dir = fresh();
    const libc = process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6";
    const script = `import { claimInstance } from ${JSON.stringify(path.resolve(import.meta.dir, "../desktop/src/single-instance.ts"))};
      import { dlopen, FFIType, ptr } from "bun:ffi";
      await claimInstance({ dir: ${JSON.stringify(dir)}, handoff: { kind: "show" }, scheme: "kiwi", onHandoff: () => {} });
      const sh = dlopen(${JSON.stringify(libc)}, { system: { args: [FFIType.ptr], returns: FFIType.i32 } }).symbols;
      const cmd = new TextEncoder().encode("sleep 4.321 >/dev/null 2>&1 &\\0");
      sh.system(ptr(cmd)); process.exit(0);`;
    Bun.spawnSync(["bun", "-e", script]);
    try {
      expect(Bun.spawnSync(["pgrep", "-f", "^sleep 4.321$"]).exitCode).toBe(0);
      expect(await claim(dir, { kind: "show" })).toMatchObject({ kind: "first" });
    } finally {
      Bun.spawnSync(["pkill", "-f", "^sleep 4.321$"]);
    }
  });

  test("with nobody answering, a second start gives up instead of opening the store", async () => {
    const dir = fresh();
    fs.mkdirSync(dir, { recursive: true });
    const blocker = await claim(dir, { kind: "show" });
    if (blocker.kind === "first") fs.rmSync(path.join(dir, SOCKET_FILE));
    const started = Date.now();
    expect(await claim(dir, { kind: "show" }, [], 300)).toEqual({ kind: "second", delivered: false });
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
  });

  test("the socket answers only a well-formed handoff, and nothing past 4 KB", async () => {
    const dir = fresh();
    const got: Handoff[] = [];
    await claim(dir, { kind: "show" }, got);
    const ask = (raw: string) =>
      new Promise<string>((resolve) => {
        const c = net.connect(path.join(dir, SOCKET_FILE));
        let answer = "";
        c.on("connect", () => c.write(raw));
        c.on("data", (d) => (answer += d.toString()));
        c.on("close", () => resolve(answer));
      });
    expect(await ask('{"kind":"rm -rf"}\n')).toBe("no\n");
    expect(await ask("not json\n")).toBe("no\n");
    expect(await ask(`{"kind":"link","url":"${"x".repeat(5000)}"}`)).toBe("no\n");
    expect(await ask('{"kind":"link","url":"file:///etc/passwd"}\n')).toBe("no\n");
    expect(got).toEqual([]);
  });
});

describe("what a start hands over", () => {
  test("the first kiwi:// argument is the link; anything else is show", () => {
    expect(handoffFor(["/Applications/Channels.app/Contents/MacOS/launcher", "kiwi://join/abc"], "kiwi")).toEqual({ kind: "link", url: "kiwi://join/abc" });
    expect(handoffFor(["/usr/bin/channels-desktop", "--flag"], "kiwi")).toEqual({ kind: "show" });
    expect(handoffFor([`kiwi://join/${"x".repeat(3000)}`], "kiwi")).toEqual({ kind: "show" });
  });

  test("only show and a link of at most 2 KB are read back", () => {
    expect(readHandoff('{"kind":"show"}', "kiwi")).toEqual({ kind: "show" });
    expect(readHandoff('{"kind":"link","url":"kiwi://join/x"}', "kiwi")).toEqual({ kind: "link", url: "kiwi://join/x" });
    for (const bad of [
      '{"kind":"link"}',
      '{"kind":"link","url":7}',
      '{"kind":"link","url":"https://evil.example/"}',
      '{"kind":"link","url":"kiwix://join/x"}',
      "[]",
      "null",
      "{",
      `{"kind":"link","url":"kiwi://${"y".repeat(2049)}"}`,
    ])
      expect(readHandoff(bad, "kiwi")).toBeNull();
  });
});

describe("waking from sleep nudges the keys, by timer drift (T438)", () => {
  const fakeClock = () => {
    let t = 1_000;
    let tick: (() => void) | null = null;
    const clock: WakeClock = {
      now: () => t,
      every: (fn) => ((tick = fn), () => (tick = null)),
    };
    return { clock, advance: (ms: number) => ((t += ms), tick?.()), stopped: () => tick === null };
  };

  test("a tick that comes late by more than the slack is a wake", () => {
    expect(slept(5_000, 5_000, 15_000)).toBe(false);
    expect(slept(20_000, 5_000, 15_000)).toBe(false);
    expect(slept(20_001, 5_000, 15_000)).toBe(true);
  });

  test("ticks on time say nothing; a sleep says it once", () => {
    const { clock, advance, stopped } = fakeClock();
    let wakes = 0;
    const stop = watchWake(() => wakes++, 5_000, 15_000, clock);
    for (let i = 0; i < 10; i++) advance(5_000);
    expect(wakes).toBe(0);
    advance(10 * 60_000);
    expect(wakes).toBe(1);
    advance(5_000);
    expect(wakes).toBe(1);
    stop();
    expect(stopped()).toBe(true);
  });
});

describe("the tray and the app menu say what Electron's did (T438)", () => {
  const ready = { version: "0.27.0", state: "ready" as const, url: "https://example.com/x.zip" };

  test("the tray: Open Channels, Restart to update when one is ready, Quit", () => {
    expect(trayItems(null)).toEqual([{ type: "normal", label: "Open Channels", action: "open" }, { type: "separator" }, { type: "normal", label: "Quit", action: "quit" }]);
    expect(trayItems({ ...ready, state: "downloading" }).map((i) => ("label" in i ? i.label : "-"))).toEqual(["Open Channels", "-", "Quit"]);
    expect(trayItems(ready)[1]).toEqual({ type: "normal", label: "Restart to update to 0.27.0", action: "restart" });
  });

  const labels = (items: AppMenuItem[]): string[] => items.map((i) => ("label" in i && i.label ? i.label : "role" in i ? i.role : "-"));
  const sub = (items: AppMenuItem[], label: string): AppMenuItem[] => {
    const m = items.find((i) => "label" in i && i.label === label);
    return m && "submenu" in m ? m.submenu : [];
  };

  test("the Mac gets the app menu; every platform gets File, Edit, View and Window", () => {
    expect(labels(appMenu("darwin"))).toEqual(["Channels", "File", "Edit", "View", "Window"]);
    expect(labels(appMenu("linux"))).toEqual(["File", "Edit", "View", "Window"]);
    expect(labels(sub(appMenu("darwin"), "Channels"))).toEqual(["About Channels", "-", "Hide Channels", "hideOthers", "showAll", "-", "Quit Channels"]);
    expect(labels(sub(appMenu("darwin"), "Edit"))).toEqual(["undo", "redo", "-", "cut", "copy", "paste", "pasteAndMatchStyle", "delete", "selectAll"]);
  });

  test("View keeps the text sizes on ⌘0, ⌘= and ⌘-, with reload and the developer tools", () => {
    const view = sub(appMenu("darwin"), "View");
    const keyed = view.flatMap((i) => ("action" in i ? [[i.action, i.accelerator ?? ""]] : []));
    expect(keyed).toEqual([
      ["reload", "r"],
      ["devtools", ""],
      ["text-reset", "0"],
      ["text-bigger", "="],
      ["text-smaller", "-"],
    ]);
    expect(view.at(-1)).toEqual({ role: "toggleFullScreen", accelerator: "Ctrl+Cmd+f" });
  });

  test("a packaged app ships no developer tools in View; reload stays (#1002)", () => {
    const actions = sub(appMenu("darwin", true), "View").flatMap((i) => ("action" in i ? [i.action] : []));
    expect(actions).toEqual(["reload", "text-reset", "text-bigger", "text-smaller"]);
    expect(sub(appMenu("linux", true), "View").some((i) => "action" in i && i.action === "devtools")).toBe(false);
  });

  test("the Mac's app and window roles carry their keys, which Electrobun gives only the edit roles: ⌘Q quits, ⌘W closes, ⌘H hides (T970)", () => {
    const keys = appMenu("darwin")
      .flatMap((m) => ("submenu" in m ? m.submenu : []))
      .flatMap((i) => ("role" in i && i.accelerator ? [[i.role, i.accelerator]] : []));
    expect(keys).toEqual([
      ["hide", "h"],
      ["hideOthers", "Cmd+Alt+h"],
      ["quit", "q"],
      ["close", "w"],
      ["toggleFullScreen", "Ctrl+Cmd+f"],
      ["minimize", "m"],
    ]);
  });

  test("a click is read back only as one of the app's own actions", () => {
    expect(menuAction({ data: { id: 3, action: "quit" } })).toBe("quit");
    expect(menuAction({ data: { action: "text-bigger" } })).toBe("text-bigger");
    for (const e of [null, {}, { data: null }, { data: { action: "rm" } }, { data: { action: 1 } }, "quit"]) expect(menuAction(e)).toBeNull();
    expect([textStepOf("text-bigger"), textStepOf("text-smaller"), textStepOf("text-reset"), textStepOf("quit")]).toEqual(["bigger", "smaller", "reset", null]);
  });

  test("Linux has no app menu, so libkiwi-shell's shortcuts (numbered as kiwi-shell.c sends them) carry the menu's actions (T769)", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(shortcutAction)).toEqual(["text-bigger", "text-smaller", "text-reset", "reload", "quit", "close", "fullscreen"]);
    for (const n of [0, 8, -1, 1.5]) expect(shortcutAction(n)).toBeNull();
  });
});
