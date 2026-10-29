import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { arrowHead, base64Blob, base64Bytes, fitSide, markedName, meaningful, penPath, rect, strokeWidth, textSize, toImage, TOOL_KEYS } from "./annotate";

describe("annotate geometry", () => {
  test("a rect from any two corners", () => {
    expect(rect({ x: 30, y: 40 }, { x: 10, y: 5 })).toEqual({ x: 10, y: 5, w: 20, h: 35 });
  });

  test("the arrow head's wings sit behind the tip, one on each side", () => {
    const [a, b] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    expect(a.x).toBeLessThan(100);
    expect(b.x).toBeLessThan(100);
    expect(Math.sign(a.y)).toBe(-Math.sign(b.y));
    expect(Math.hypot(100 - a.x, a.y)).toBeCloseTo(10);
  });

  test("a pen path starts with a move and rounds to tenths", () => {
    expect(
      penPath([
        { x: 1.234, y: 2 },
        { x: 3, y: 4.56 },
      ]),
    ).toBe("M1.2 2 L3 4.6");
  });

  test("stroke and text grow with the picture but have a floor", () => {
    expect(strokeWidth(300, 200)).toBe(2);
    expect(strokeWidth(2880, 1800)).toBe(7);
    expect(textSize(300, 200)).toBe(14);
    expect(textSize(2880, 1800)).toBe(60);
  });

  test("tiny marks and empty text are dropped", () => {
    expect(meaningful({ kind: "pen", ink: "alert", points: [{ x: 1, y: 1 }] }, 4)).toBe(false);
    expect(meaningful({ kind: "arrow", ink: "alert", from: { x: 0, y: 0 }, to: { x: 2, y: 2 } }, 4)).toBe(false);
    expect(meaningful({ kind: "box", ink: "alert", from: { x: 0, y: 0 }, to: { x: 40, y: 2 } }, 4)).toBe(false);
    expect(meaningful({ kind: "hide", from: { x: 0, y: 0 }, to: { x: 40, y: 20 } }, 4)).toBe(true);
    expect(meaningful({ kind: "text", ink: "ink", at: { x: 0, y: 0 }, text: "  " }, 4)).toBe(false);
  });

  test("a pointer maps from screen to image pixels, clamped to the picture", () => {
    const box = { left: 100, top: 50, width: 500, height: 250 };
    const natural = { width: 2000, height: 1000 };
    expect(toImage(350, 175, box, natural)).toEqual({ x: 1000, y: 500 });
    expect(toImage(0, 999, box, natural)).toEqual({ x: 0, y: 1000 });
  });
});

describe("annotate export", () => {
  test("the longest side is capped, keeping the ratio", () => {
    expect(fitSide(4800, 2400, 2400)).toEqual({ width: 2400, height: 1200, scale: 0.5 });
    expect(fitSide(800, 600, 2400)).toEqual({ width: 800, height: 600, scale: 1 });
  });

  test("a marked copy is named after the original, with the type it's sent as", () => {
    expect(markedName("screen.png", "image/png")).toBe("screen-marked.png");
    expect(markedName("screen.png", "image/jpeg")).toBe("screen-marked.jpg");
    expect(markedName("", "image/webp")).toBe("image-marked.webp");
  });

  test("base64 size is the decoded byte count", () => {
    expect(base64Bytes(btoa("abc"))).toBe(3);
    expect(base64Bytes(btoa("abcd"))).toBe(4);
    expect(base64Bytes(btoa("abcde"))).toBe(5);
  });

  test("an image's base64 becomes a Blob of its bytes, with no fetch of a data: URL, which the app's and the site's CSP block", async () => {
    const blob = base64Blob(btoa("\x89PNG\r\n"), "image/png");
    expect(blob.type).toBe("image/png");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const connect = (headers: string) => /connect-src ([^;]*)/.exec(headers)?.[1] ?? "";
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    expect(connect(readFileSync(join(root, "ui/public/_headers"), "utf8"))).not.toContain("data:");
    const fetchesData = ["packages/app/src", "ui/src"].flatMap((dir) =>
      [...new Glob("**/*.{ts,tsx}").scanSync(join(root, dir))].map((f) => join(dir, f)).filter((f) => /fetch\(\s*[`"']data:/.test(readFileSync(join(root, f), "utf8"))),
    );
    expect(fetchesData).toEqual([]);
  });

  test("every tool has a single-letter shortcut", () => {
    expect(Object.values(TOOL_KEYS).sort()).toEqual(["arrow", "box", "hide", "move", "pen", "text"]);
  });
});
