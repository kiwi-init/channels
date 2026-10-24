import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const APP = "desktop/build/entitlements.app.plist";
const keys = (file: string) => [...readFileSync(file, "utf8").matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);

test("the Mac app's Bun gets JIT and writable executable memory, nothing more: no microphone", () => {
  expect(keys(APP)).toEqual(["com.apple.security.cs.allow-jit", "com.apple.security.cs.allow-unsigned-executable-memory"]);
  expect(readFileSync("desktop/scripts/eb-release.ts", "utf8")).toContain('path.join(desktop, "build", "entitlements.app.plist")');
});
