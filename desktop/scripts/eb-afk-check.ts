import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { startRelay } from "../../src/relay/bun.ts";
import { devHumanAuth } from "../../src/relay/human.ts";
import { daemonStop } from "../src/daemon-client.ts";
import { appExecutable, attach, launch, stop, testEnv, until } from "./eb-drive.ts";
import { firstChannel } from "./eb-first-run.ts";

if (!process.argv[2] || process.platform !== "darwin") {
  console.error("usage, on a Mac: bun desktop/scripts/eb-afk-check.ts <the app built with CHANNELS_EB_TEST=1> [screenshot dir]");
  process.exit(2);
}

const bundle = process.argv[2];
const exe = appExecutable(bundle);
const shots = process.argv[3] ?? null;
const root = mkdtempSync(join(tmpdir(), "kiwi-afk-check-"));
const sceneFile = join(root, ".kiwi", "afk", "scene.html");
const problems: string[] = [];
const check = (ok: boolean, what: string) => {
  if (!ok) problems.push(what);
  console.log(`${ok ? "ok" : "FAIL"} ${what}`);
};

const relay = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(root, "relay"), human: devHumanAuth(), githubPush: null, devNoRateLimits: true });
const RELAY = `http://127.0.0.1:${relay.port}`;

const afkNow = (): { shown: boolean; scene: string | null; frame: string | null; sandbox: string | null; focus: string } => {
  const afk = document.querySelector<HTMLElement>(".afk");
  const f = afk?.querySelector("iframe");
  return {
    shown: !!afk,
    scene: afk?.dataset["scene"] ?? null,
    frame: f?.getAttribute("src") ?? null,
    sandbox: f?.getAttribute("sandbox") ?? null,
    focus: document.activeElement?.tagName ?? "none",
  };
};

async function shot(name: string): Promise<void> {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  const file = join(shots, `${name}.png`);
  const r = spawnSync("screencapture", ["-x", file], { stdio: "ignore" });
  console.log(r.status === 0 && existsSync(file) ? `shot ${file}` : `no shot for ${name} here`);
}

const SWAPPED = `<!doctype html><style>html,body{margin:0;height:100%;background:linear-gradient(rgb(40 70 160),rgb(220 140 90))}</style><script>
addEventListener("message", (e) => { if (e.data && e.data.kiwi === "afk" && e.data.type === "state") document.body.dataset.needs = String(e.data.needs) })
requestAnimationFrame(() => parent.postMessage({ kiwi: "afk", type: "ready" }, "*"))
</script>`;

const app = launch(exe, testEnv(root, join(root, "driver.sock"), RELAY));
try {
  const d = await attach(join(root, "driver.sock"));
  await firstChannel(d, 0);
  const afk = () => d.evaluate(afkNow, null, 2_000);
  const press = (key: string, command = false) =>
    d.evaluate(
      (k: { key: string; command: boolean }) => {
        const mac = navigator.platform.startsWith("Mac");
        (document.activeElement ?? document.body).dispatchEvent(
          new KeyboardEvent("keydown", { key: k.key, code: `Key${k.key.toUpperCase()}`, metaKey: k.command && mac, ctrlKey: k.command && !mac, bubbles: true, cancelable: true }),
        );
      },
      { key, command },
      2_000,
    );
  const waitFor = (what: string, ms: number, ok: (a: Awaited<ReturnType<typeof afk>>) => boolean) =>
    until(what, ms, async () => {
      const a = await afk().catch(() => null);
      return a && ok(a) ? a : null;
    }).catch(async () => {
      console.log(`AFK at "${what}": ${JSON.stringify(await afk().catch(String))}`);
      return null;
    });

  check(!existsSync(sceneFile), "a fresh ~/.kiwi has no AFK scene yet");
  await press("t", true);
  const first = await waitFor("the default AFK scene, ready", 30_000, (a) => a.scene === "ready");
  check(!!first, "⌘T shows AFK, and its default scene says it's ready");
  check(first?.frame === "views://internal/afk-frame.html" && first.sandbox === "allow-scripts", `the scene runs in the sandboxed AFK frame (${first?.frame} ${first?.sandbox})`);
  check(existsSync(sceneFile) && readFileSync(sceneFile, "utf8").includes("<script>"), "on the first AFK the app writes its default scene to ~/.kiwi/afk/scene.html");
  check(first?.focus !== "IFRAME", `the page keeps focus while the scene runs, so keys reach AFK (${first?.focus})`);
  await shot("afk-default");
  await press("x");
  check(!!(await waitFor("AFK, gone after a key", 10_000, (a) => !a.shown)), "a key still leaves AFK while the scene's frame is up");

  mkdirSync(dirname(sceneFile), { recursive: true });
  writeFileSync(sceneFile, SWAPPED);
  await press("t", true);
  const swapped = await waitFor("the swapped AFK scene, ready", 15_000, (a) => a.scene === "ready");
  check(!!swapped, "a scene file swapped in shows the next time AFK starts, with no rebuild");
  check(readFileSync(sceneFile, "utf8") === SWAPPED, "the app leaves the person's file as it is");
  await shot("afk-swapped");
  await press("x");
  check(!!(await waitFor("AFK, gone after the swapped scene", 10_000, (a) => !a.shown)), "a key leaves the swapped scene too");

  rmSync(sceneFile);
  await press("t", true);
  const plain = await waitFor("AFK with no scene file", 15_000, (a) => a.scene === "plain");
  check(!!plain, "with the file deleted, AFK shows the plain sky");
  check(!existsSync(sceneFile), "and the app doesn't write the file again");
  await shot("afk-plain");
  await press("x");
  check(!!(await waitFor("AFK, gone after the plain sky", 10_000, (a) => !a.shown)), "a key leaves the plain sky");

  writeFileSync(sceneFile, "<!doctype html><script>throw new Error('a broken scene')</script>");
  await press("t", true);
  const broken = await waitFor("AFK with a broken scene", 15_000, (a) => a.scene === "plain");
  check(!!broken, "a scene that never says ready gives way to the plain sky after 8 s");
  await press("x");
  await waitFor("AFK, gone after the broken scene", 10_000, (a) => !a.shown);

  check(app.exitCode === null && app.signalCode === null, "the app is still running");
  d.close();
} catch (e) {
  problems.push(e instanceof Error ? e.message : String(e));
  console.log(`FAIL ${problems.at(-1)}`);
} finally {
  await stop(app);
  await daemonStop(join(root, ".kiwi"), 2_000).catch(() => false);
  relay.stop(true);
  rmSync(root, { recursive: true, force: true });
}
if (problems.length) process.exit(1);
console.log("ok: AFK reads its scene from ~/.kiwi/afk/scene.html in a sandboxed frame; swapping the file changes it, deleting it gives the plain sky");
