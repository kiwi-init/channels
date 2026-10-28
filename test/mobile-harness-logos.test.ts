import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { monoHarness } from "../web/src/lib/harness.ts";

const ROOT = join(import.meta.dir, "..");
const ASSETS = join(ROOT, "assets/harness");
const IOS = join(ROOT, "ios/Channels/Assets.xcassets");
const ANDROID = join(ROOT, "android/app/src/main/res/drawable-nodpi");
const KIT = readFileSync(join(ROOT, "android/app/src/main/java/com/kiwiinit/channels/ui/Kit.kt"), "utf8");

const harnesses = readdirSync(ASSETS)
  .filter((f) => f.endsWith(".svg"))
  .map((f) => f.replace(/\.svg$/, ""));

const shapes = (svg: string) => [...svg.matchAll(/<path[^>]*>/g)].map(([tag]) => / d="([^"]*)"/.exec(tag)?.[1]);

describe("the phone apps carry every harness logo the desktop app draws", () => {
  test("there are logos to carry", () => {
    expect(harnesses.length).toBeGreaterThan(10);
  });

  test("iOS has each one as an image set with the same shapes, a template exactly when the mark is drawn in one color", () => {
    for (const h of harnesses) {
      const set = join(IOS, `harness-${h}.imageset`);
      const svg = join(set, `${h}.svg`);
      expect([h, existsSync(svg)]).toEqual([h, true]);
      if (!existsSync(svg)) continue;
      expect([h, shapes(readFileSync(svg, "utf8"))]).toEqual([h, shapes(readFileSync(join(ASSETS, `${h}.svg`), "utf8"))]);
      const contents = JSON.parse(readFileSync(join(set, "Contents.json"), "utf8"));
      expect([h, contents.images]).toEqual([h, [{ filename: `${h}.svg`, idiom: "universal" }]]);
      expect([h, contents.properties?.["template-rendering-intent"] === "template"]).toEqual([h, monoHarness(h)]);
    }
  });

  test("Android has each one as a drawable its harness map names", () => {
    for (const h of harnesses) {
      const drawable = `harness_${h.replace(/-/g, "_")}`;
      expect([h, existsSync(join(ANDROID, `${drawable}.png`))]).toEqual([h, true]);
      expect([h, KIT.includes(`"${h}" to R.drawable.${drawable},`)]).toEqual([h, true]);
    }
  });
});
