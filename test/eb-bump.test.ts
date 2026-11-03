import { describe, expect, test } from "bun:test";

import { bumped, changes, coreName, coreUrl } from "../desktop/scripts/eb-bump.ts";
import type { Pins } from "../desktop/scripts/eb-pins.ts";

const pins: Pins = {
  electrobun: "2026.10.1",
  releasesBaseUrl: "https://example.test/releases/download",
  hutch: { version: "1", platforms: {} },
  devkit: { "macos-arm64": "old-devkit", "linux-x64": "old-devkit" },
  app: {
    "macos-arm64": {
      "Contents/MacOS/launcher": "launcher-1",
      "Contents/MacOS/libElectrobunCore.dylib": "core-1",
      "Contents/Resources/uninstall": "extractor-1",
      "Contents/Resources/main.js": "main-1",
    },
  },
};

describe("eb-bump", () => {
  test("a pinned path names the file at the top of the core archive, and uninstall ships as extractor", () => {
    expect(coreName("Contents/MacOS/libElectrobunCore.dylib")).toBe("libElectrobunCore.dylib");
    expect(coreName("Contents/Resources/uninstall")).toBe("extractor");
  });

  test("the core archive of a Mac key is the darwin one", () => {
    expect(coreUrl(pins.releasesBaseUrl, "2026.11.0", "macos-arm64")).toBe("https://example.test/releases/download/v2026.11.0/electrobun-core-darwin-arm64.tar.gz");
    expect(coreUrl(pins.releasesBaseUrl, "2026.11.0", "linux-x64")).toBe("https://example.test/releases/download/v2026.11.0/electrobun-core-linux-x64.tar.gz");
  });

  test("a bump moves the version, every devkit and the app files the release changed, and keeps Hutch", () => {
    const core = new Map([
      ["launcher", "launcher-1"],
      ["libElectrobunCore.dylib", "core-2"],
      ["extractor", "extractor-2"],
      ["main.js", "main-1"],
    ]);
    const next = bumped(pins, "2026.11.0", { "macos-arm64": "new-devkit", "linux-x64": "new-devkit" }, { "macos-arm64": core });
    expect(next.electrobun).toBe("2026.11.0");
    expect(next.hutch).toBe(pins.hutch);
    expect(next.app["macos-arm64"]).toEqual({
      "Contents/MacOS/launcher": "launcher-1",
      "Contents/MacOS/libElectrobunCore.dylib": "core-2",
      "Contents/Resources/uninstall": "extractor-2",
      "Contents/Resources/main.js": "main-1",
    });
    expect(changes(pins, next)).toEqual(["macos-arm64 Contents/MacOS/libElectrobunCore.dylib", "macos-arm64 Contents/Resources/uninstall", "macos-arm64 devkit", "linux-x64 devkit"]);
  });

  test("a file the release no longer ships keeps its pin, so the build's own check catches it", () => {
    const next = bumped(pins, "2026.11.0", { "macos-arm64": "d", "linux-x64": "d" }, { "macos-arm64": new Map() });
    expect(next.app["macos-arm64"]).toEqual(pins.app["macos-arm64"]);
  });

  test("a platform with no devkit or core in the release fails the bump", () => {
    expect(() => bumped(pins, "2026.11.0", { "macos-arm64": "d" }, { "macos-arm64": new Map() })).toThrow("no devkit for linux-x64");
    expect(() => bumped(pins, "2026.11.0", { "macos-arm64": "d", "linux-x64": "d" }, {})).toThrow("no core for macos-arm64");
  });
});
