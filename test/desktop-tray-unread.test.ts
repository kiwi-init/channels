import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { trayTitle, unreadFile, unreadLabel, unreadSvg } from "../desktop/src/tray-unread.ts";

const assets = join(import.meta.dir, "..", "desktop", "assets");
const base = readFileSync(join(assets, "channels-tray-symbolic.svg"), "utf8");

describe("the tray's unread mark (#1746)", () => {
  test("counts show 1 to 9, then 9+, and nothing at zero", () => {
    expect([0, -1, Number.NaN].map(unreadLabel)).toEqual([null, null, null]);
    expect([1, 3, 9].map(unreadLabel)).toEqual(["1", "3", "9"]);
    expect([10, 250].map(unreadLabel)).toEqual(["9+", "9+"]);
  });

  test("the tray's title says how many are unread, with the same count as the badge", () => {
    expect(trayTitle(0)).toBe("Channels");
    expect(trayTitle(3)).toBe("Channels · 3 unread");
    expect(trayTitle(250)).toBe("Channels · 250 unread");
  });

  test("the unread icon is the symbol, cut around a red count, keeping the panel's text colour", () => {
    const svg = unreadSvg(base, "3");
    expect(svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">');
    expect(svg).toEndWith("</svg>");
    expect(svg).toContain('<g mask="url(#unread-cut)">');
    expect(svg).toContain('class="ColorScheme-Text"');
    expect(svg).toContain('fill="#ff6259"');
    expect(svg).toContain(">3</text>");
    expect(unreadSvg(base, "9+")).toContain(">9+</text>");
    expect(() => unreadSvg("not an svg", "1")).toThrow("the tray icon isn't an SVG");
  });

  test("each unread file is named -symbolic, so Electrobun sends it by name and KDE recolors it for the panel (#420)", () => {
    const symbolic = /^[^/]+-symbolic\.svg$/;
    expect(unreadFile("3")).toBe("channels-tray-unread-3-symbolic.svg");
    expect(unreadFile("9+")).toBe("channels-tray-unread-many-symbolic.svg");
    expect(["1", "9", "9+"].map(unreadFile).every((name) => symbolic.test(name))).toBe(true);
  });

  test("the count is centred by its own offset, since KDE's SVG renderer ignores dominant-baseline", () => {
    const svg = unreadSvg(base, "3");
    expect(svg).not.toContain("dominant-baseline");
    expect(svg).toContain('<text x="70" y="39"');
    expect(unreadSvg(base, "9+")).toContain('<text x="70" y="37"');
  });

  test("the Mac has its unread template next to the plain one, the @2x files the tray loads", () => {
    expect(existsSync(join(assets, "trayTemplate@2x.png"))).toBe(true);
    expect(existsSync(join(assets, "trayUnreadTemplate@2x.png"))).toBe(true);
  });
});
