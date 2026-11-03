import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tmuxPastesFlag } from "../src/loop/kimi.ts";
import { wakeHarness } from "./wake-harness.ts";

setDefaultTimeout(60_000);

const tmuxPastes = !!Bun.which("tmux") && tmuxPastesFlag(new TextDecoder().decode(Bun.spawnSync(["tmux", "-V"]).stdout));

const IDLE = ["  Antigravity CLI 1.4.12", "─".repeat(60), ">", "─".repeat(60), "? for shortcuts                       auto · Gemini 3.8 Flash · low"].join("\r\n");
const BUSY = ["  ⣻  Running command...", "─".repeat(60), ">", "─".repeat(60), "esc to cancel                         auto · Gemini 3.8 Flash · low"].join("\r\n");

const FAKE_AGY = (state: string, got: string) => `
import { appendFileSync, readFileSync } from "node:fs";
const screens = { idle: ${JSON.stringify(IDLE)}, busy: ${JSON.stringify(BUSY)} };
let shown = "";
const draw = () => {
  let want = "idle";
  try { want = readFileSync(${JSON.stringify(state)}, "utf8").trim(); } catch {}
  if (want === shown) return;
  shown = want;
  process.stdout.write("\\x1b[2J\\x1b[H" + (screens[want] ?? screens.idle));
};
draw();
setInterval(draw, 100);
process.stdout.write("\\x1b[?2004h");
process.stdin.setRawMode(true);
process.stdin.resume();
let buf = "";
process.stdin.on("data", (d) => {
  buf += d.toString();
  const open = buf.indexOf("\\x1b[200~");
  const close = buf.indexOf("\\x1b[201~");
  if (open >= 0 && close > open && /[\\r\\n]/.test(buf.slice(close + 6))) {
    appendFileSync(${JSON.stringify(got)}, JSON.stringify({ at: Date.now(), screen: shown, prompt: buf.slice(open + 6, close) }) + "\\n");
    buf = "";
  }
});
`;

const w = wakeHarness();
const { bindAs, until, seat, quiet } = w;

describe.skipIf(!tmuxPastes)("waking an idle agy agent by typing into its own tmux pane", () => {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-wake-tmux-"));
  const sock = join("/tmp", `kiwi-wt-${process.pid}.sock`);
  const state = join(dir, "state");
  const got = join(dir, "got.jsonl");
  const tmux = (...args: string[]) => Bun.spawnSync(["tmux", "-S", sock, ...args], { stdout: "pipe", stderr: "pipe" });
  let pane = "";

  const typed = (): { at: number; screen: string; prompt: string }[] =>
    (existsSync(got) ? readFileSync(got, "utf8") : "")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { at: number; screen: string; prompt: string });

  beforeAll(() => {
    writeFileSync(state, "idle");
    const script = join(dir, "agy.ts");
    writeFileSync(script, FAKE_AGY(state, got));
    expect(tmux("new-session", "-d", "-s", "agy", "-x", "120", "-y", "30", `${process.execPath} ${script}`).exitCode).toBe(0);
    pane = new TextDecoder().decode(tmux("display", "-p", "-t", "agy", "#{pane_id}").stdout).trim();
    bindAs({ harness: "agy", session: "conv-1", tmux: { socket: sock, pane } });
  });

  afterAll(() => {
    tmux("kill-server");
    rmSync(sock, { force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  test("a message for it is typed into its pane once its prompt is idle, and never while a turn runs", async () => {
    await quiet();
    writeFileSync(state, "busy");
    await Bun.sleep(300);
    const sent = Date.now();
    await w.ownerCh.send("a message for the agy agent", { to: ["claude"] });
    await Bun.sleep(3_000);
    expect(typed()).toEqual([]);

    writeFileSync(state, "idle");
    await until("the wake typed into its pane", () => typed().length === 1, 20_000);
    const [wake] = typed();
    expect(wake!.screen).toBe("idle");
    expect(wake!.prompt).toContain("kiwi");
    expect(wake!.at).toBeGreaterThan(sent);
    await until("the wake's record", async () => (await seat())?.wake.last?.via === "tmux-typing");
    expect((await seat())?.wake.last?.ok).toBe(true);
  });
});
