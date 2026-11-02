import { expect, test } from "bun:test";
import { RELEASE_KEY } from "../src/cli/release-key.ts";
import { RELEASE_KEY as DESKTOP_RELEASE_KEY } from "../desktop/src/release-key.ts";
import { minisignVerifies } from "../src/cli/minisign.ts";
import { throwawayKey } from "./minisign-sign.ts";

test("the CLI and the app pin the same release key", () => {
  expect(RELEASE_KEY).toBe(DESKTOP_RELEASE_KEY);
});

test("the CLI's verifier accepts a minisign signature and refuses a broken one", () => {
  const key = throwawayKey();
  const sums = Buffer.from("aa11  kiwi-linux-x64.gz\n");
  const changed = Buffer.from("bb22  kiwi-linux-x64.gz\n");
  expect(minisignVerifies(sums, key.sign(sums, "kiwi v9.9.9 SHA256SUMS"), key.publicKey)).toBe(true);
  expect(minisignVerifies(changed, key.sign(sums, "kiwi v9.9.9 SHA256SUMS"), key.publicKey)).toBe(false);
  expect(minisignVerifies(sums, key.sign(sums, "kiwi v9.9.9 SHA256SUMS"), throwawayKey().publicKey)).toBe(false);
});
