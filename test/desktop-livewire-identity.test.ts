import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";

const desktop = path.join(import.meta.dirname, "..", "desktop");

function configWith(env: Record<string, string>): { app: { name: string; identifier: string; urlSchemes?: string[] }; build: { bun: { define: Record<string, string> } } } {
  const r = spawnSync(process.execPath, ["-e", 'console.log(JSON.stringify((await import("./electrobun.config.ts")).default))'], {
    cwd: desktop,
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", ...env },
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

test("a release build of the Livewire branch is Channels Livewire: its own id and name, and no kiwi:// handler, so it sits beside stable Channels (T839)", () => {
  const release = configWith({ CHANNELS_EB_RELEASE: "1" });
  expect(release.app.identifier).toBe("com.kiwiinit.channels.livewire");
  expect(release.app.name).toBe("Channels Livewire");
  expect(release.app.urlSchemes).toBeUndefined();
  expect(release.build.bun.define["KIWI_EB_LIVEWIRE"]).toBe("true");
});

test("dev builds are Livewire's too, and test builds stay the test identity", () => {
  const dev = configWith({});
  expect(dev.app.identifier).toBe("com.kiwiinit.channels.livewire.dev");
  expect(dev.app.urlSchemes).toBeUndefined();
  expect(dev.build.bun.define["KIWI_EB_LIVEWIRE"]).toBe("true");
  const testBuild = configWith({ CHANNELS_EB_TEST: "1" });
  expect(testBuild.app.identifier).toBe("com.kiwiinit.channels.test");
  expect(testBuild.app.name).toBe("Channels");
  expect(testBuild.build.bun.define["KIWI_EB_LIVEWIRE"]).toBe("false");
});
