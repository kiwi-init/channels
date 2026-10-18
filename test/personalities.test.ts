import { describe, expect, test } from "bun:test";
import { cleanPersonalities, cleanPersonality, copyOf, freeId, MAX_PERSONALITIES, PRESET_IDS } from "@kiwi/core/personalities.ts";
import { PRESETS, type Personality } from "@kiwi/core/personality.ts";
import { snapshotOf } from "../desktop/src/guard.ts";

const webOnly: Personality = {
  id: "web-only",
  name: "Web only",
  glyph: "✳",
  role: "builder",
  capabilities: ["write", "tasks", "prs", "merge", "notes"],
  areas: ["web/"],
  instructions: "Build in web/ only.",
};

describe("personalities on the person's account", () => {
  test("the six presets for code work, each one valid", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["builder", "reviewer", "bug-hunter", "explorer", "releaser", "lead"]);
    for (const p of PRESETS) expect(cleanPersonality(p)).toEqual(p);
  });

  test("one of your own needs an id, one glyph and a valid persona", () => {
    expect(cleanPersonality(webOnly)).toEqual(webOnly);
    expect(cleanPersonality({ ...webOnly, id: "Web Only" })).toBeNull();
    expect(cleanPersonality({ ...webOnly, id: "x".repeat(41) })).toBeNull();
    expect(cleanPersonality({ ...webOnly, glyph: "ab" })).toBeNull();
    expect(cleanPersonality({ ...webOnly, glyph: " " })).toBeNull();
    expect(cleanPersonality({ ...webOnly, glyph: "🦊" })).toMatchObject({ glyph: "🦊" });
    expect(cleanPersonality({ ...webOnly, role: "wizard" })).toBeNull();
    expect(cleanPersonality({ ...webOnly, capabilities: ["write", "fly"] })).toBeNull();
    expect(cleanPersonality({ ...webOnly, name: "" })).toBeNull();
  });

  test("the list keeps yours only: no preset ids, no repeats, no broken ones, at most fifty", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...webOnly, id: `p-${i}` }));
    expect(cleanPersonalities([{ ...PRESETS[0]!, glyph: "x" }, webOnly, webOnly, { junk: true }]).map((p) => p.id)).toEqual(["web-only"]);
    expect(cleanPersonalities(many)).toHaveLength(MAX_PERSONALITIES);
    expect(cleanPersonalities("nope")).toEqual([]);
  });

  test("a copy takes a free id from its name", () => {
    const taken = new Set([...PRESET_IDS, "web-only"]);
    expect(freeId("Web only", taken)).toBe("web-only-2");
    expect(freeId("!!!", taken)).toBe("personality");
    const c = copyOf(PRESETS[0]!, taken);
    expect(c).toMatchObject({ id: "builder-copy", name: "Builder copy", role: "builder" });
    expect(c.capabilities).not.toBe(PRESETS[0]!.capabilities);
  });

  test("the desktop's snapshot hands the page only valid ones, and none from an older store", () => {
    const base = { relayUrl: "https://r.example", person: null, channels: [], computers: [], pending: [] };
    expect(snapshotOf(base).personalities).toEqual([]);
    expect(snapshotOf({ ...base, personalities: [webOnly, { ...webOnly, id: "BAD" }] }).personalities).toEqual([webOnly]);
  });
});
