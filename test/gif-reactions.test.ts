import { kiwiCmd } from "./owner.ts";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pack from "../site/reactions/index.json";
import { isGifReaction, wellFormedEvent, wellFormedReaction } from "@kiwi/core/protocol.ts";

describe("gif reactions", () => {
  test("a reaction is an emoji or a gif key, nothing else", () => {
    expect(wellFormedReaction("👍")).toBe(true);
    expect(wellFormedReaction("ok/trailer")).toBe(true);
    expect(wellFormedReaction("thinking/the-bear-help")).toBe(true);
    for (const bad of ["ok", "OK/trailer", "ok/../x", "ok/trailer/x", "/trailer", "ok/", "ok/trailer ", "ok/<b>", "a".repeat(30) + "/x", "ok/" + "a".repeat(49)])
      expect(wellFormedReaction(bad)).toBe(false);
  });

  test("only a key is a gif reaction", () => {
    expect(isGifReaction("ok/trailer")).toBe(true);
    expect(isGifReaction("👍")).toBe(false);
  });

  test("the react event carries a gif key", () => {
    expect(wellFormedEvent({ op: "react", seq: 3, emoji: "nope/soft-no" })).toBe(true);
    expect(wellFormedEvent({ op: "react", seq: 3, emoji: "nope/Soft No" })).toBe(false);
  });

  test("every gif in the pack has a file under its reaction, a feeling and a size an image may have", async () => {
    for (const g of pack) {
      expect(isGifReaction(`${g.reaction}/${g.name}`)).toBe(true);
      expect(g.feeling.length).toBeGreaterThan(0);
      const file = Bun.file(join(import.meta.dir, "..", "site", "reactions", g.reaction, `${g.name}.webp`));
      expect(await file.exists()).toBe(true);
      expect(file.size).toBeLessThanOrEqual(256 * 1024);
    }
    const files = readdirSync(join(import.meta.dir, "..", "site", "reactions"), { recursive: true }).filter((f) => String(f).endsWith(".webp"));
    expect(files.length).toBe(pack.length);
  });

  test("kiwi react --list names every gif an agent may use", async () => {
    const home = mkdtempSync(join(tmpdir(), "kiwi-gifs-"));
    try {
      const p = Bun.spawn(kiwiCmd(["react", "--list"]), { cwd: home, env: { ...process.env, KIWI_HOME: home, KIWI_NO_HOOKS: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const out = await new Response(p.stdout).text();
      expect(await p.exited).toBe(0);
      for (const g of pack) expect(out).toContain(`${g.reaction}/${g.name}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
