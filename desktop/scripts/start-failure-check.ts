import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const [app, out] = [process.argv[2], process.argv[3]];
if (!app || !out || process.platform !== "linux" || !process.env.DISPLAY) {
  console.error("usage (on Linux, under Xvfb): bun desktop/scripts/start-failure-check.ts <the app's folder, with bin/launcher> <folder for the screenshot>");
  process.exit(2);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function find(dir: string, ends: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? find(full, ends) : full.endsWith(ends) ? [full] : [];
  });
}

function png(xwd: Buffer): Buffer {
  const at = (i: number): number => xwd.readUInt32BE(i * 4);
  const [headerSize, width, height, byteOrder, bitsPerPixel, bytesPerLine, colors] = [at(0), at(4), at(5), at(7), at(11), at(12), at(19)];
  if (bitsPerPixel !== 32 && bitsPerPixel !== 24) throw new Error(`the screen dump has ${bitsPerPixel} bits per pixel, not 24 or 32`);
  const step = bitsPerPixel / 8;
  const start = headerSize + colors * 12;
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    for (let x = 0; x < width; x++) {
      const p = start + y * bytesPerLine + x * step;
      const [r, g, b] = byteOrder === 0 ? [xwd[p + 2]!, xwd[p + 1]!, xwd[p]!] : [xwd[p + step - 3]!, xwd[p + step - 2]!, xwd[p + step - 1]!];
      rows.set([r, g, b], row + 1 + x * 3);
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const frame = Buffer.alloc(8 + body.length);
    frame.writeUInt32BE(data.length, 0);
    body.copy(frame, 4);
    frame.writeUInt32BE(Number(Bun.hash.crc32(body)), 4 + body.length);
    return frame;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const root = mkdtempSync(join(tmpdir(), "kiwi-start-failure-"));
const broken = join(root, "app");
const home = join(root, "home");
mkdirSync(home);
mkdirSync(out, { recursive: true });
cpSync(app, broken, { recursive: true, verbatimSymlinks: true });
const templates = find(broken, join("page", "index.html"));
if (templates.length !== 1) {
  console.error(`start-failure-check: expected one page/index.html in the app, found ${templates.length}`);
  process.exit(1);
}
rmSync(templates[0]!);

const problems: string[] = [];
const child = spawn(join(broken, "bin", "launcher"), [], {
  env: {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local", "state"),
  },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let said = "";
child.stdout.on("data", (d: Buffer) => (said += d.toString()));
child.stderr.on("data", (d: Buffer) => (said += d.toString()));
let code: number | null | undefined;
child.on("exit", (c) => (code = c));

const logged = (): string => {
  const log = existsSync(home) ? find(home, "main.log")[0] : undefined;
  return log ? readFileSync(log, "utf8") : "";
};
const boxes = (): string[] => spawnSync("xdotool", ["search", "--onlyvisible", "--name", ".*"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);

try {
  for (let i = 0; i < 120 && code === undefined && !boxes().length; i++) await sleep(500);
  await sleep(1500);
  const windows = boxes();
  if (!logged().includes("the window couldn't start")) problems.push(`main.log doesn't say the window couldn't start: ${logged().slice(0, 400) || "empty"}`);
  if (!said.includes("Channels: the window couldn't start")) problems.push("the console doesn't say the window couldn't start");
  if (code !== undefined) problems.push(`the app quit (${code}) before anyone could read why`);
  if (!windows.length) problems.push("no message box is on screen");
  const dump = spawnSync("xwd", ["-root", "-silent"], { maxBuffer: 64 * 1024 * 1024 });
  if (dump.status === 0) writeFileSync(join(out, "start-failure.png"), png(dump.stdout));
  else problems.push(`xwd couldn't take the screenshot: ${dump.stderr.toString().slice(0, 200)}`);
  for (const id of windows) {
    spawnSync("xdotool", ["windowfocus", "--sync", id], { timeout: 3000 });
    spawnSync("xdotool", ["key", "--window", id, "Return"]);
  }
  spawnSync("xdotool", ["key", "Return"]);
  for (let i = 0; i < 20 && code === undefined; i++) await sleep(500);
  if (code === undefined) problems.push("the app was still running 10 s after OK was pressed");
  else if (code !== 1) problems.push(`the app quit with ${code}, not 1`);
} finally {
  if (code === undefined) {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      // The group ended between the check and the signal.
    }
  }
  writeFileSync(join(out, "start-failure.log"), `${said}\n--- main.log ---\n${logged()}`);
  rmSync(root, { recursive: true, force: true });
}

for (const p of problems) console.error(`start-failure-check: ${p}`);
if (!problems.length) console.log(`a start that fails logs why, shows a message box and quits with 1 once it is dismissed; screenshot in ${join(out, "start-failure.png")}`);
process.exit(problems.length ? 1 : 0);
