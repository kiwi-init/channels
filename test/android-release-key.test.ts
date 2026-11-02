import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const gradle = readFileSync(join(root, "android/app/build.gradle.kts"), "utf8");
const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");

const block = (text: string, open: string): string => {
  const at = text.indexOf(open);
  if (at < 0) throw new Error(`no ${open} in the file`);
  let depth = 0;
  let end = -1;
  for (let i = at + open.length - 1; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error(`unbalanced ${open}`);
  return text.slice(at, end + 1);
};

describe("the Android release build never signs with the public debug key", () => {
  test("the release build type signs with the release config only, or not at all", () => {
    const release = block(block(gradle, "buildTypes {"), "release {");
    expect(release).toContain('signingConfig = signingConfigs.getByName("release")');
    expect(release).not.toContain('"debug"');
    expect(release).not.toContain("debug.p12");
  });

  test("the release keystore comes from the environment, and the committed debug key stays with the debug build", () => {
    const debug = block(block(gradle, "signingConfigs {"), 'getByName("debug") {');
    const release = block(block(gradle, "signingConfigs {"), 'create("release") {');
    expect(debug).toContain('storeFile = file("debug.p12")');
    expect(release).not.toContain("debug.p12");
    expect(release).toContain('secret("KIWI_ANDROID_KEYSTORE")');
    expect(release).toContain('secret("KIWI_ANDROID_STORE_PASSWORD")');
    expect(release).toContain('secret("KIWI_ANDROID_KEY_ALIAS")');
  });

  test("a secret CI passes as an empty string counts as unset, so a branch without the secrets builds unsigned instead of failing (T312)", () => {
    const release = block(block(gradle, "signingConfigs {"), 'create("release") {');
    expect(release).toContain("val secret = { name: String -> System.getenv(name)?.takeIf { it.isNotEmpty() } }");
    expect(release).not.toMatch(/System\.getenv\("KIWI_ANDROID_/);
  });

  test("CI signs with the repo's secret keystore or leaves the APK unsigned, and keeps both names", () => {
    const at = ci.indexOf("  android:");
    if (at < 0) throw new Error("no android job in ci.yml");
    const job = ci.slice(at, ci.indexOf("\n  # The one check", at));
    expect(job).toContain("secrets.KIWI_ANDROID_KEYSTORE_BASE64");
    expect(job).toContain("secrets.KIWI_ANDROID_STORE_PASSWORD");
    expect(job).toContain("KIWI_ANDROID_KEYSTORE=");
    expect(job).toContain("app-release-unsigned.apk");
    expect(job).not.toContain("debug.p12");
    expect(job).not.toMatch(/storePassword.*android\b/s);
  });
});
