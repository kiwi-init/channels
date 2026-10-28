import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPlacedSeat } from "../packages/core/src/terminals.ts";
import { clampSize, controlOutput, keyCommands, openTerm, readPaneInfo, seedOf, unescapeOutput, TERM_COLS } from "../src/daemon/hosted-term.ts";
import { HOSTED_SESSION, HostedTmux, findTmux } from "../src/daemon/hosted-tmux.ts";
import { onHostedSocket } from "../src/terminals/shared/tmux.ts";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);
const tmux = await findTmux();

describe("control mode's pane output", () => {
  test("octal escapes come back as the bytes they stand for, the rest as it was", () => {
    expect(text(unescapeOutput(bytes("\\033[1mhi\\015\\012\\134n ✻")))).toBe("\x1b[1mhi\r\n\\n ✻");
    expect(text(unescapeOutput(bytes("a\\0b\\9999")))).toBe("a\\0b\\9999");
  });

  test("%output and %extended-output name their pane and carry the data; other lines don't", () => {
    expect(controlOutput(bytes("%output %3 \\033[Hx"))).toEqual({ pane: "%3", data: bytes("\x1b[Hx") });
    expect(controlOutput(bytes("%extended-output %12 4021 : a : b"))).toEqual({ pane: "%12", data: bytes("a : b") });
    expect(controlOutput(bytes("%output %3 "))).toEqual({ pane: "%3", data: bytes("") });
    for (const line of ["%begin 1 2 0", "%output @3 x", "%output %3x", "%extended-output %3 12", "hosted-ping"]) expect(controlOutput(bytes(line))).toBeNull();
  });

  test("a UTF-8 character split across two %output lines decodes whole", () => {
    const star = bytes("✻");
    const decoder = new TextDecoder();
    const a = controlOutput(new Uint8Array([...bytes("%output %1 "), ...star.subarray(0, 2)]))!;
    const b = controlOutput(new Uint8Array([...bytes("%output %1 "), ...star.subarray(2)]))!;
    expect(decoder.decode(a.data, { stream: true }) + decoder.decode(b.data, { stream: true })).toBe("✻");
  });
});

describe("typing into a pane", () => {
  test("ASCII goes as hex bytes, so quotes, semicolons and control keys pass untouched", () => {
    expect(keyCommands("%3", "a';\x1b[A\r")).toEqual(["send-keys -t %3 -H 61 27 3b 1b 5b 41 0d"]);
  });

  test("anything else goes literally, in order, and a long paste is split", () => {
    expect(keyCommands("%3", "é ok✻")).toEqual(["send-keys -t %3 -l 'é'", "send-keys -t %3 -H 20 6f 6b", "send-keys -t %3 -l '✻'"]);
    const cmds = keyCommands("%3", "x".repeat(600));
    expect(cmds).toHaveLength(3);
    expect(cmds.every((c) => c.startsWith("send-keys -t %3 -H 78"))).toBe(true);
  });

  test("sizes are whole numbers held to the drawer's range", () => {
    expect(clampSize(10, TERM_COLS)).toBe(20);
    expect(clampSize(120, TERM_COLS)).toBe(120);
    expect(clampSize(9_000, TERM_COLS)).toBe(400);
    for (const bad of [0, -1, 1.5, "80", null]) expect(clampSize(bad, TERM_COLS)).toBeNull();
  });
});

describe("the drawer's first screen", () => {
  const info = { window: "@1", cols: 10, rows: 3, cursor: { x: 2, y: 1, shown: false }, alternate: false, dead: false };

  test("clears, draws every captured line, then puts the cursor back where tmux has it", () => {
    expect(seedOf("old\n\x1b[31mred\nb\n\n", info)).toBe("\x1b[0m\x1b[H\x1b[2J\x1b[3Jold\x1b[0m\r\n\x1b[31mred\x1b[0m\r\nb\x1b[0m\r\n\x1b[0m\x1b[2;3H\x1b[?25l");
    expect(seedOf("x\n", { ...info, alternate: true, cursor: { x: 0, y: 0, shown: true } })).toBe("\x1b[0m\x1b[H\x1b[2J\x1b[3J\x1b[?1049h\x1b[Hx\x1b[0m\x1b[1;1H\x1b[?25h");
  });

  test("reads tmux's pane line, or nothing from a line that isn't one", () => {
    expect(readPaneInfo(`${HOSTED_SESSION}\t@4\t120\t40\t3\t39\t1\t0\t0\n`)).toEqual({
      session: HOSTED_SESSION,
      window: "@4",
      cols: 120,
      rows: 40,
      cursor: { x: 3, y: 39, shown: true },
      alternate: false,
      dead: false,
    });
    expect(readPaneInfo("")).toBeNull();
    expect(readPaneInfo("s\t@1\tx\t40\t0\t0\t1\t0\t0")).toBeNull();
  });
});

describe("hosted seats", () => {
  test("a seat on Channels' own tmux socket is hosted; any other socket is plain tmux", () => {
    expect(onHostedSocket("/tmp/kiwi-501/abc123", 501)).toBe(true);
    expect(onHostedSocket("/private/tmp/kiwi-501/abc123", 501)).toBe(true);
    expect(onHostedSocket("/tmp/kiwi-502/abc123", 501)).toBe(false);
    expect(onHostedSocket("/tmp/tmux-501/default", 501)).toBe(false);
  });

  test("the app reads a hosted seat like a tmux one, with its own place", () => {
    const seat = { place: "hosted" as const, alias: "work", agent: "ada", socket: "/tmp/kiwi-501/abc", pane: "%4" };
    expect(readPlacedSeat(seat)).toEqual(seat);
    expect(readPlacedSeat({ ...seat, pane: "4" })).toBeNull();
  });
});

describe("a drawer on a hosted pane", () => {
  const home = mkdtempSync(join(tmpdir(), "kiwi-term-home-"));
  const hosted = new HostedTmux(home);
  afterAll(async () => {
    await hosted.kill();
    rmSync(home, { recursive: true, force: true });
  });

  const until = async (ok: () => boolean): Promise<void> => {
    for (let i = 0; i < 100 && !ok(); i++) await Bun.sleep(50);
  };

  test.if(!!tmux)("sizes the pane, seeds its screen, streams what follows, takes keys, and stops when closed", async () => {
    const folder = mkdtempSync(join(tmpdir(), "kiwi-term-work-"));
    const placed = await hosted.open({ argv: ["/bin/sh", "-c", 'printf "ready ✻\\n"; stty -echo; exec cat'], folder, name: "agent", env: {} });
    if (!placed.ok || placed.place !== "hosted") throw new Error(JSON.stringify(placed));
    const st = hosted.state()!;
    await until(() => (hosted.pane(placed.pane)?.screen() ?? "").includes("ready"));

    let out = "";
    let ended = false;
    const term = await openTerm(hosted, placed.pane, 90, 20, (msg) => {
      if ("out" in msg) out += msg.out;
      else ended = true;
      return true;
    });
    expect(term.opened).toMatchObject({ window: placed.window, cols: 90, rows: 20, dead: false });
    expect(term.opened.seed).toContain("ready ✻");
    expect((await hosted.tmux(st, ["display-message", "-p", "-t", placed.pane, "#{pane_width}x#{pane_height}"])).stdout.trim()).toBe("90x20");
    term.start();

    expect(hosted.keys(placed.pane, "héllo 'there';\r")).toBe(true);
    await until(() => out.includes("héllo 'there';"));
    expect(out).toContain("héllo 'there';");

    const size = async (): Promise<string> => (await hosted.tmux(st, ["display-message", "-p", "-t", placed.pane, "#{pane_width}x#{pane_height}"])).stdout.trim();
    expect(hosted.resize(placed.pane, 70, 15)).toBe(true);
    let now = "";
    for (let i = 0; i < 40 && now !== "70x15"; i++) now = (await Bun.sleep(25), await size());
    expect(now).toBe("70x15");

    term.close();
    const before = out.length;
    hosted.keys(placed.pane, "after\r");
    await Bun.sleep(300);
    expect(out.length).toBe(before);

    const again = await openTerm(hosted, placed.pane, 70, 15, (msg) => ("ended" in msg ? ((ended = true), true) : true));
    again.start();
    await hosted.tmux(st, ["kill-window", "-t", placed.window]);
    await until(() => ended);
    expect(ended).toBe(true);
    rmSync(folder, { recursive: true, force: true });
  });

  test.if(!!tmux)("refuses a pane that isn't one of Channels' own windows", async () => {
    await expect(openTerm(hosted, "%9999", 80, 24, () => true)).rejects.toThrow("isn't one of Channels' own windows");
    await expect(openTerm(hosted, "@1", 80, 24, () => true)).rejects.toThrow("pane id like %3");
  });

  test.if(!!tmux)("holds a wake's typing back while a person types in the drawer", async () => {
    const st = hosted.state()!;
    const r = await hosted.tmux(st, ["new-window", "-d", "-t", `=${HOSTED_SESSION}`, "-P", "-F", "#{pane_id}", "cat"]);
    const pane = r.stdout.trim();
    expect(hosted.pane(pane)!.type("free")).toBe(true);
    hosted.keys(pane, "x");
    expect(hosted.pane(pane)!.type("wake")).toBe(false);
    expect(hosted.pane(pane)!.enter()).toBe(false);
  });
});
