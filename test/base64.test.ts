import { describe, expect, test } from "bun:test";
import { b64url, fromB64url, fromBase64, toBase64 } from "@kiwi/core/crypto.ts";

const every = Uint8Array.from({ length: 256 }, (_, i) => i);

describe("base64 decoding gives back the exact bytes", () => {
  test("every byte value, through both alphabets", () => {
    expect([...fromB64url(b64url(every))]).toEqual([...every]);
    expect([...fromBase64(toBase64(every))]).toEqual([...every]);
  });

  test("every length from 0 to 64, padded or not", () => {
    for (let n = 0; n <= 64; n++) {
      const bytes = crypto.getRandomValues(new Uint8Array(n));
      expect([...fromB64url(b64url(bytes))]).toEqual([...bytes]);
      expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
      expect([...fromBase64(toBase64(bytes).replace(/=+$/, ""))]).toEqual([...bytes]);
    }
  });

  test("the url-safe alphabet decodes like the standard one", () => {
    expect([...fromB64url("-_-_")]).toEqual([...fromBase64("+/+/")]);
    expect([...fromB64url("-_-_")]).toEqual([0xfb, 0xff, 0xbf]);
  });

  test("input that isn't base64 still throws", () => {
    expect(() => fromB64url("a")).toThrow();
    expect(() => fromBase64("%%%%")).toThrow();
  });
});
