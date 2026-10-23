import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [apk, shots] = process.argv.slice(2);
if (!apk || !shots) throw new Error("usage: bun android/scripts/device-check.ts <app-release.apk> <shots dir>");
const repo = join(import.meta.dir, "../..");
const app = "com.kiwiinit.channels";
mkdirSync(shots, { recursive: true });

interface Node {
  text: string;
  desc: string;
  x: number;
  y: number;
}

const run = async (args: string[]): Promise<string> => {
  const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`${args.join(" ")} exited ${code}: ${err.trim()}`);
  return out;
};
const adb = (...args: string[]): Promise<string> => run(["adb", ...args]);

const shoot = async (name: string): Promise<void> => {
  const p = Bun.spawn(["adb", "exec-out", "screencap", "-p"], { stdout: "pipe" });
  writeFileSync(join(shots, `${name}.png`), new Uint8Array(await new Response(p.stdout).arrayBuffer()));
  await p.exited;
};

const screen = async (): Promise<Node[]> => {
  await adb("shell", "uiautomator", "dump", "/sdcard/ui.xml");
  const xml = await adb("shell", "cat", "/sdcard/ui.xml");
  const attr = (node: string, name: string): string => node.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";
  return [...xml.matchAll(/<node [^>]*>/g)].flatMap(([node]) => {
    const b = attr(node, "bounds").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!b) return [];
    const [x1, y1, x2, y2] = b.slice(1).map(Number) as [number, number, number, number];
    return [{ text: attr(node, "text"), desc: attr(node, "content-desc"), x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) }];
  });
};

const find = async (match: (n: Node) => boolean, ms = 30_000): Promise<Node | null> => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const hit = (await screen()).find(match);
    if (hit) return hit;
    await Bun.sleep(1_000);
  }
  return null;
};

const tap = (n: Node): Promise<string> => adb("shell", "input", "tap", String(n.x), String(n.y));

let failed = 0;
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};

const dir = mkdtempSync(join(tmpdir(), "android-device-"));
const relay = Bun.spawn(["bun", "ios/scripts/dev-channel.ts", "--port", "8790", "--dir", dir, "--host", "10.0.2.2"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
const said: string[] = [];
void (async () => {
  const decoder = new TextDecoder();
  for await (const chunk of relay.stdout) said.push(...decoder.decode(chunk).split("\n"));
})();
const heard = async (pred: (line: string) => boolean, ms: number): Promise<boolean> => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (said.some(pred)) return true;
    await Bun.sleep(500);
  }
  return false;
};

try {
  const codeFile = join(dir, "link-code.txt");
  for (let i = 0; i < 600 && !existsSync(codeFile); i++) await Bun.sleep(100);
  if (!existsSync(codeFile)) throw new Error(`the dev channel never printed a link code: ${await new Response(relay.stderr).text()}`);
  const code = readFileSync(codeFile, "utf8").trim();

  await adb("install", "-r", apk);
  await adb("logcat", "-c");
  await adb("shell", "am", "start", "-W", "-n", `${app}/.MainActivity`);
  check((await find((n) => n.text === "Link this phone", 60_000)) !== null, "the app opens on Link this phone: the engine loaded in the WebView");
  await shoot("1-link");

  await adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", `kiwi://link/${code}`, app);
  check((await find((n) => n.text === "Check the code", 30_000)) !== null, "a kiwi://link opens the digits");
  await shoot("2-digits");
  check(await heard((l) => l.startsWith("linked "), 60_000), "the dev channel's Mac sees the phone link");

  const channel = await find((n) => n.text.startsWith("onemouse"), 60_000);
  check(channel !== null, "the channel shows in the list");
  await Bun.sleep(4_000);
  await shoot("3-list");

  if (channel) {
    await tap(channel);
    check((await find((n) => n.text.includes("Board is up"), 30_000)) !== null, "the conversation shows the lead's messages");
    await Bun.sleep(2_000);
    await shoot("4-conversation");

    const field = await find((n) => n.text === "Message", 30_000);
    check(field !== null, "the dock's field is there");
    if (field) {
      await tap(field);
      await adb("shell", "input", "text", "Hello%sfrom%sAndroid");
      await Bun.sleep(800);
      const send = await find((n) => n.desc === "Send", 10_000);
      check(send !== null, "the send button shows once there's text");
      if (send) {
        await tap(send);
        check(await heard((l) => l.endsWith(": Hello from Android"), 30_000), "the message reaches the channel");
        check((await find((n) => n.text.includes("On it.") || n.text.includes("Good call"), 30_000)) !== null, "the lead's answer shows");
        await adb("shell", "input", "keyevent", "111");
        await Bun.sleep(1_500);
        await shoot("5-sent");
      }
    }

    const title = await find((n) => n.text === "onemouse", 10_000);
    if (title) {
      await tap(title);
      check((await find((n) => n.text === "Crew", 15_000)) !== null, "the title opens the details with the crew");
      await Bun.sleep(1_500);
      await shoot("6-details");
      await adb("shell", "input", "keyevent", "4");
      await Bun.sleep(1_500);
    }

    const flip = await find((n) => n.desc.startsWith("Open your chat with"), 10_000);
    check(flip !== null, "the lead chat button is in the header");
    if (flip) {
      await tap(flip);
      await Bun.sleep(2_500);
      await shoot("7-lead");
    }
    await adb("shell", "input", "keyevent", "4");
    await Bun.sleep(1_500);
  }

  await adb("shell", "cmd", "uimode", "night", "yes");
  await Bun.sleep(3_000);
  await shoot("8-list-dark");
  await adb("shell", "cmd", "uimode", "night", "no");

  const log = await adb("logcat", "-d", "-b", "crash");
  check(!log.includes(app), "no crash in logcat");
  if (log.includes(app)) console.log(log);
} finally {
  writeFileSync(join(shots, "logcat.txt"), await adb("logcat", "-d").catch((e: unknown) => String(e)));
  writeFileSync(join(shots, "dev-channel.txt"), said.join("\n"));
  relay.kill();
  await relay.exited;
  rmSync(dir, { recursive: true, force: true });
}
if (failed) console.log(`${failed} check${failed === 1 ? "" : "s"} failed`);
process.exit(failed ? 1 : 0);
