import { describe, expect, test } from "bun:test";

import { bumped, changes, coreName, coreUrl, hutchNote, pairedHutch } from "../desktop/scripts/eb-bump.ts";
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

  test("a Linux key's files come from the Linux core, by the same names (T7239)", () => {
    const linux: Pins = { ...pins, app: { ...pins.app, "linux-x64": { "bin/libNativeWrapper.so": "wrapper-1", "Resources/uninstall": "extractor-1", "bin/bun": "bun-1" } } };
    const core = new Map([
      ["libNativeWrapper.so", "wrapper-2"],
      ["extractor", "extractor-2"],
    ]);
    const next = bumped(linux, "2026.11.0", { "macos-arm64": "d", "linux-x64": "d" }, { "macos-arm64": new Map(), "linux-x64": core });
    expect(next.app["linux-x64"]).toEqual({ "bin/libNativeWrapper.so": "wrapper-2", "Resources/uninstall": "extractor-2", "bin/bun": "bun-1" });
  });

  test("a file the release no longer ships keeps its pin, so the build's own check catches it", () => {
    const next = bumped(pins, "2026.11.0", { "macos-arm64": "d", "linux-x64": "d" }, { "macos-arm64": new Map() });
    expect(next.app["macos-arm64"]).toEqual(pins.app["macos-arm64"]);
  });

  test("the Hutch a Livewire release pairs with is the cli= of its hutch.config.ts's @hutch line", () => {
    expect(pairedHutch('// @hutch cli=0.29.0 cottontail=0.7.3\nimport { defineConfig } from "hutch";\n')).toBe("0.29.0");
    expect(pairedHutch("// @hutch cli=0.28.2-canary.8\n")).toBe("0.28.2-canary.8");
    expect(pairedHutch('import { defineConfig } from "hutch";\n// hutch cli=0.29.0\n')).toBeNull();
  });

  test("a bump whose Livewire pairs a Hutch other than the pinned one says so and isn't paired (2026.11.4 on Hutch 0.29.0)", () => {
    expect(hutchNote("0.29.0", "0.29.0")).toBeNull();
    expect(hutchNote("0.29.0", "0.28.2-canary.8")).toBe(
      "Livewire pairs Hutch 0.29.0, and Channels pins Hutch 0.28.2-canary.8. eb-bump.ts moves only the Livewire pins, so this bump stays open for a person or an agent to move Hutch with it.",
    );
  });

  test("a platform with no devkit or core in the release fails the bump", () => {
    expect(() => bumped(pins, "2026.11.0", { "macos-arm64": "d" }, { "macos-arm64": new Map() })).toThrow("no devkit for linux-x64");
    expect(() => bumped(pins, "2026.11.0", { "macos-arm64": "d", "linux-x64": "d" }, {})).toThrow("no core for macos-arm64");
  });
});
