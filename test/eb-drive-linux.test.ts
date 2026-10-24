import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appExecutable, appRoot, LINUX_ENTRY } from "../desktop/scripts/eb-drive.ts";

test("on Linux the driver starts an app folder's bin/electrobun-launcher, past bin/launcher's allowlist that keeps KIWI_EB_* out, and stops everything under that folder (T1552)", () => {
  const app = mkdtempSync(join(tmpdir(), "eb-drive-linux-"));
  try {
    mkdirSync(join(app, "bin"));
    writeFileSync(join(app, LINUX_ENTRY), "");
    writeFileSync(join(app, "bin", "launcher"), "");
    expect(appExecutable(app)).toBe(join(app, "bin", "electrobun-launcher"));
    expect(appRoot(appExecutable(app))).toBe(app);
    expect(appRoot(join(app, "bin", "launcher"))).toBe(join(app, "bin", "launcher"));
    expect(appRoot("/Applications/Channels.app/Contents/MacOS/launcher")).toBe("/Applications/Channels.app");
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});
