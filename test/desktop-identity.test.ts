import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { ebDataDir } from "../desktop/src/store-eb.ts";

const desktop = path.join(import.meta.dirname, "..", "desktop");

interface Config {
  app: { name: string; identifier: string; urlSchemes?: string[] };
  build: { bun: { define: Record<string, string> } };
  runtime: { inspector: boolean };
}

function configWith(env: Record<string, string>): Config {
  const r = spawnSync(process.execPath, ["-e", 'console.log(JSON.stringify((await import("./electrobun.config.ts")).default))'], {
    cwd: desktop,
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", ...env },
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout) as Config;
}

test("a release build is Channels, com.kiwiinit.channels, with the kiwi:// handler: the app 2026.10.6 installed, so its updater takes it in place", () => {
  const release = configWith({ CHANNELS_EB_RELEASE: "1" });
  expect(release.app).toMatchObject({ name: "Channels", identifier: "com.kiwiinit.channels", urlSchemes: ["kiwi"] });
  expect(release.build.bun.define).toMatchObject({ KIWI_EB_TEST: "false", KIWI_EB_OFFICIAL_UI: "true", KIWI_EB_DEV: "false" });
});

test("only dev builds keep the web inspector, so a shipped app has no Inspect Element (T1009)", () => {
  expect(configWith({ CHANNELS_EB_RELEASE: "1" }).runtime.inspector).toBe(false);
  expect(configWith({ CHANNELS_EB_TEST: "1" }).runtime.inspector).toBe(false);
  expect(configWith({}).runtime.inspector).toBe(true);
  expect(configWith({ CHANNELS_EB_RELEASE: "1", CHANNELS_EB_LOCAL_UI: "1" }).runtime.inspector).toBe(true);
});

test("dev and test builds keep their own ids and never take kiwi:// links; dev builds may boot a local UI channel", () => {
  const dev = configWith({});
  expect(dev.app).toEqual(expect.objectContaining({ name: "Channels", identifier: "com.kiwiinit.channels.dev" }));
  expect(dev.app.urlSchemes).toBeUndefined();
  expect(dev.build.bun.define).toMatchObject({ KIWI_EB_TEST: "false", KIWI_EB_OFFICIAL_UI: "true", KIWI_EB_DEV: "true" });
  const testBuild = configWith({ CHANNELS_EB_TEST: "1" });
  expect(testBuild.app).toEqual(expect.objectContaining({ name: "Channels", identifier: "com.kiwiinit.channels.test" }));
  expect(testBuild.app.urlSchemes).toBeUndefined();
  expect(testBuild.build.bun.define).toMatchObject({ KIWI_EB_TEST: "true", KIWI_EB_OFFICIAL_UI: "false", KIWI_EB_DEV: "false" });
  expect(configWith({ CHANNELS_EB_RELEASE: "1", CHANNELS_EB_LOCAL_UI: "1" }).build.bun.define["KIWI_EB_DEV"]).toBe("true");
});

test("the release keeps 2026.10.6's data folder, so nobody loses channels or keys", () => {
  expect(ebDataDir("com.kiwiinit.channels", "stable", "darwin", "/Users/ana", {})).toBe("/Users/ana/Library/Application Support/com.kiwiinit.channels/stable");
  expect(ebDataDir("com.kiwiinit.channels", "stable", "linux", "/home/ana", {})).toBe("/home/ana/.local/share/com.kiwiinit.channels/stable");
});

test("nothing in the app moves the kiwi CLI out of ~/.kiwi or names a second app", () => {
  const src = path.join(desktop, "src");
  for (const f of readdirSync(src, { recursive: true, encoding: "utf8" }).filter((n) => n.endsWith(".ts"))) {
    const text = readFileSync(path.join(src, f), "utf8");
    expect({ f, sideBySide: /\.kiwi-livewire|Channels Livewire|com\.kiwiinit\.channels\.livewire/.test(text) }).toEqual({ f, sideBySide: false });
  }
});
