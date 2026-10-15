import { expect, test } from "bun:test";

import { swapAsset } from "../desktop/src/update-asset.ts";

test("a Mac swaps itself for the zip for its CPU", () => {
  expect(swapAsset("0.14.0", "darwin", "arm64")).toBe("Kiwi-0.14.0-mac-arm64.zip");
  expect(swapAsset("0.14.0", "darwin", "x64")).toBe("Kiwi-0.14.0-mac-x64.zip");
});

test("Linux and Windows never swap themselves: the update is only offered with the release link", () => {
  expect(swapAsset("0.14.0", "linux", "x64")).toBeNull();
  expect(swapAsset("0.14.0", "linux", "arm64")).toBeNull();
  expect(swapAsset("0.14.0", "win32", "x64")).toBeNull();
});
