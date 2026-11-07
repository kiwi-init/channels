import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AFK_SCENE_BYTES, afkScene, afkSceneFile, keepAfkScene } from "../desktop/src/afk-scene.ts";

const roots: string[] = [];

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function place() {
  const root = mkdtempSync(join(tmpdir(), "kiwi-afk-scene-"));
  roots.push(root);
  return { home: join(root, ".kiwi"), record: join(root, "data", "afk-scene.json") };
}

const SCENE = `<!doctype html><script>parent.postMessage({ kiwi: "afk", type: "ready" }, "*")</script>`;

describe("the AFK scene is a file in ~/.kiwi/afk (T26)", () => {
  test("on the first start there's no file yet, so the app is asked for its default once, and keeps it", () => {
    const at = place();
    expect(afkScene(at)).toEqual({ html: null, first: true });
    expect(keepAfkScene(at, SCENE)).toBe(SCENE);
    expect(readFileSync(afkSceneFile(at.home), "utf8")).toBe(SCENE);
    expect(afkScene(at)).toEqual({ html: SCENE, first: false });
    expect(keepAfkScene(at, "<p>another default</p>")).toBe(SCENE);
  });

  test("a swapped file shows the next time AFK starts, with no rebuild", () => {
    const at = place();
    keepAfkScene(at, SCENE);
    writeFileSync(afkSceneFile(at.home), "<p>mine</p>");
    expect(afkScene(at).html).toBe("<p>mine</p>");
  });

  test("a deleted file stays deleted: AFK falls back to a plain sky, and the default isn't written again", () => {
    const at = place();
    keepAfkScene(at, SCENE);
    rmSync(afkSceneFile(at.home));
    expect(afkScene(at)).toEqual({ html: null, first: false });
    expect(keepAfkScene(at, SCENE)).toBeNull();
    expect(existsSync(afkSceneFile(at.home))).toBe(false);
  });

  test("a person's own file from before the app wrote one is kept, and never overwritten", () => {
    const at = place();
    mkdirSync(join(at.home, "afk"), { recursive: true });
    writeFileSync(afkSceneFile(at.home), "<p>mine</p>");
    expect(afkScene(at)).toEqual({ html: "<p>mine</p>", first: false });
    expect(keepAfkScene(at, SCENE)).toBe("<p>mine</p>");
  });

  test("an empty file, a folder in its place or one over 8 MB reads as no scene", () => {
    const at = place();
    keepAfkScene(at, SCENE);
    writeFileSync(afkSceneFile(at.home), "");
    expect(afkScene(at).html).toBeNull();
    writeFileSync(afkSceneFile(at.home), "x".repeat(AFK_SCENE_BYTES + 1));
    expect(afkScene(at).html).toBeNull();
    rmSync(afkSceneFile(at.home));
    mkdirSync(afkSceneFile(at.home));
    expect(afkScene(at).html).toBeNull();
  });

  test("a default that is empty or over 8 MB isn't kept", () => {
    const at = place();
    expect(keepAfkScene(at, "  ")).toBeNull();
    expect(keepAfkScene(at, "x".repeat(AFK_SCENE_BYTES + 1))).toBeNull();
    expect(afkScene(at)).toEqual({ html: null, first: true });
  });
});
