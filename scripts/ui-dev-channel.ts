import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { buildUipack, generateSigningKey, signManifest, uipackFileName, type UiManifest } from "../desktop/.hutch/devkit/api/sdks/main/appengine/format.ts";
import { appExecutable } from "../desktop/scripts/eb-drive.ts";
import { UI_CONTRACT, UI_DATA_SCHEMA } from "../desktop/src/ui-contract.ts";

const ROOT = resolve(import.meta.dir, "..");
const UI = join(ROOT, "ui");
const DIST = join(UI, "dist");
const HOME = join(ROOT, "desktop", ".ui-dev");
const PORT = Number(process.env.KIWI_UI_DEV_PORT ?? 47175);
const DEV_APP = join(ROOT, "desktop", "release-eb", "build", "dev-macos-arm64", "Channels Livewire-dev.app");
const args = process.argv.slice(2);

interface Key {
  keyId: string;
  publicKey: string;
  privateKeyPem: string;
}

function key(): Key {
  const file = join(HOME, "key.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Key;
  mkdirSync(HOME, { recursive: true });
  const made = generateSigningKey();
  writeFileSync(file, JSON.stringify({ keyId: made.keyId, publicKey: made.publicKey, privateKeyPem: made.privateKeyPem }));
  chmodSync(file, 0o600);
  return made;
}

function filesOf(dir: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name !== "_headers") files.set(relative(dir, path).split(sep).join("/"), new Uint8Array(readFileSync(path)));
    }
  };
  walk(dir);
  return files;
}

const signing = key();
const channelLine = `http://127.0.0.1:${PORT}/manifest.json ${signing.keyId} ${signing.publicKey}`;
let manifest: UiManifest | null = null;
const bundles = new Map<string, Uint8Array>();

function publish(): boolean {
  const built = spawnSync("bunx", ["vite", "build", "--logLevel", "warn"], { cwd: UI, stdio: "inherit", env: { ...process.env, ...(args.includes("--demo") ? { VITE_KIWI_DEMO: "1" } : {}) } });
  if (built.status !== 0) {
    console.error("ui build failed: nothing published");
    return false;
  }
  const at = Date.now();
  const uiVersion = `dev-${new Date(at).toISOString().slice(11, 19).replaceAll(":", "")}`;
  const { bytes, sha256 } = buildUipack(uiVersion, filesOf(DIST));
  const name = uipackFileName(uiVersion, sha256);
  bundles.clear();
  bundles.set(name, bytes);
  manifest = signManifest(
    { format: "livewire-manifest/1", keyId: signing.keyId, seq: at, uiVersion, bundleUrl: name, sha256, requiresContract: `^${UI_CONTRACT}`, dataSchema: UI_DATA_SCHEMA, publishedAt: at },
    signing.privateKeyPem,
  );
  console.log(`published ${uiVersion} (${bytes.length} bytes): close the app's window and open it again to see it`);
  return true;
}

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  fetch(request) {
    const name = new URL(request.url).pathname.slice(1);
    if (name === "manifest.json") return manifest ? Response.json(manifest) : new Response("nothing published yet", { status: 404 });
    const bundle = bundles.get(name);
    return bundle ? new Response(new Blob([bundle as Uint8Array<ArrayBuffer>])) : new Response("not found", { status: 404 });
  },
});

console.log(`local UI channel on http://127.0.0.1:${PORT}\n  KIWI_EB_UI_CHANNEL="${channelLine}"`);
publish();

if (args.includes("--launch")) {
  if (!existsSync(DEV_APP)) console.error(`no dev app at ${DEV_APP}: build it once with \`cd desktop && KIWI_UI_DIST=../ui/dist bun run start:eb\``);
  else {
    spawn(appExecutable(DEV_APP), [], { env: { ...process.env, KIWI_EB_UI_CHANNEL: channelLine }, stdio: "ignore", detached: true }).unref();
    console.log(`launched ${DEV_APP} on this channel`);
  }
}

if (args.includes("--watch")) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  watch(join(UI, "src"), { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(publish, 500);
  });
  console.log("watching ui/src: every change publishes");
}
