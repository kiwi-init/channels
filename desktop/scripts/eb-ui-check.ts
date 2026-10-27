import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { startLocalRelay } from "../../scripts/local-relay.ts";
import { buildUipack, generateSigningKey, signManifest, uipackFileName, type UiManifest } from "../.hutch/devkit/api/sdks/main/appengine/format.ts";
import { appExecutable, appRoot, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";

if (!process.argv[2] || process.platform !== "darwin") {
  console.error("usage (on a Mac): bun desktop/scripts/eb-ui-check.ts <Channels.app built with CHANNELS_EB_TEST=1>");
  process.exit(2);
}

const exe = appExecutable(process.argv[2]);
const app = join(appRoot(exe), "Contents", "Resources", "app");
const root = mkdtempSync(join(tmpdir(), "kiwi-ui-check-"));
const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const key = generateSigningKey();
const problems: string[] = [];
const encode = (s: string): Uint8Array => new TextEncoder().encode(s);

function builtInFiles(): Map<string, Uint8Array> {
  const views = join(app, "views", "internal");
  const files = new Map<string, Uint8Array>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.set(relative(views, path).split(sep).join("/"), new Uint8Array(readFileSync(path)));
    }
  };
  walk(views);
  files.set("index.html", new Uint8Array(readFileSync(join(app, "page", "index.html"))));
  return files;
}

const marked = (index: string, mark: string): string => index.replace(/<head([^>]*)>/i, `<head$1><meta name="kiwi-ui" content="${mark}">`);

let manifest: UiManifest | null = null;
const bundles = new Map<string, Uint8Array>();
const channel = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const name = new URL(request.url).pathname.slice(1);
    if (name === "manifest.json") return manifest ? Response.json(manifest) : new Response("none yet", { status: 404 });
    const bundle = bundles.get(name);
    return bundle ? new Response(new Blob([bundle as Uint8Array<ArrayBuffer>])) : new Response("not found", { status: 404 });
  },
});

function publish(mark: string, change: (files: Map<string, Uint8Array>) => void = () => {}): UiManifest {
  const files = builtInFiles();
  files.set("index.html", encode(marked(new TextDecoder().decode(files.get("index.html")), mark)));
  change(files);
  const uiVersion = `check-${mark}`;
  const { bytes, sha256 } = buildUipack(uiVersion, files);
  const name = uipackFileName(uiVersion, sha256);
  bundles.set(name, bytes);
  manifest = signManifest(
    { format: "livewire-manifest/1", keyId: key.keyId, seq: Date.now(), uiVersion, bundleUrl: name, sha256, requiresContract: "^1.0.0", dataSchema: 1, publishedAt: Date.now() },
    key.privateKeyPem,
  );
  return manifest;
}

const env = testEnv(root, join(root, "driver.sock"), `http://127.0.0.1:${port}`, {
  KIWI_EB_UI_CHANNEL: `http://127.0.0.1:${channel.port}/manifest.json ${key.keyId} ${key.publicKey}`,
});

const showing = (d: Driver): Promise<string> => d.evaluate(() => document.querySelector('meta[name="kiwi-ui"]')?.getAttribute("content") ?? "built-in", null, 5_000);
const shows = (d: Driver, mark: string, ms = 60_000): Promise<string> => until(`the window showing ${mark}`, ms, async () => ((await showing(d)) === mark ? mark : null));
const visible = async (d: Driver): Promise<boolean> => ((await d.main("window")) as { visible?: unknown }).visible === true;

function engineState(): { current: UiManifest | null; good: UiManifest[]; bad: Record<string, string> } | null {
  const find = (dir: string): string | null => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name);
      if (name.isDirectory()) {
        const found = find(path);
        if (found) return found;
      } else if (name.name === "engine.json" && dir.endsWith(`${sep}appengine`)) return path;
    }
    return null;
  };
  const file = find(join(root, "home"));
  return file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

async function run(what: (d: Driver) => Promise<void>): Promise<void> {
  const started = launch(exe, env);
  try {
    const d = await attach(join(root, "driver.sock"));
    try {
      await until("the window on screen", 60_000, async () => ((await visible(d)) ? true : null));
      await what(d);
    } finally {
      d.close();
    }
  } finally {
    await stop(started);
  }
}

try {
  await run(async (d) => {
    await shows(d, "built-in");
    console.log("nothing published: the built-in UI");
  });

  const a = publish("a");
  await run(async (d) => {
    await d.main("closeWindow");
    await shows(d, "a");
    if (await visible(d)) problems.push("swapping to a new UI while the window was closed showed the window");
    console.log("published a, closed the window: a, the window still closed");
  });

  await run(async (d) => {
    await shows(d, "a", 20_000);
    if ((await showing(d)) !== "a") problems.push("after a restart the window doesn't open on a");
    await until("a promoted after probation", 60_000, async () => (engineState()?.good.some((m) => m.sha256 === a.sha256) ? true : null));
    console.log("restarted: a at startup, promoted after probation");
  });

  const b = publish("b", (files) => {
    const index = new TextDecoder().decode(files.get("index.html"));
    files.set("index.html", encode(index.replace(/<script type="module"[^>]*><\/script>/, '<script type="module" src="/assets/check-boom.js"></script>')));
    files.set("assets/check-boom.js", encode('window.kiwi.uiError("Error: check-boom");'));
  });
  await run(async (d) => {
    await shows(d, "a");
    await d.main("closeWindow");
    await until("b banned", 60_000, async () => (engineState()?.bad[b.sha256] ? true : null));
    await shows(d, "a");
    console.log(`published b, which fails at boot: banned (${engineState()?.bad[b.sha256]}), back on a`);
  });

  await run(async (d) => {
    await shows(d, "a", 20_000);
    console.log("restarted: a, b never booted again");
  });
} catch (e) {
  problems.push(e instanceof Error ? e.message : String(e));
} finally {
  relay.kill();
  void channel.stop(true);
  rmSync(root, { recursive: true, force: true });
}
if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  process.exit(1);
}
console.log("ok: the test build boots its UI from a signed channel, swaps while the window is closed, keeps a good UI across restarts and bans one that fails");
