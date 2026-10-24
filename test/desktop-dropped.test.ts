import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_DROPPED_BYTES, MAX_DROPPED_FILES, readDropped } from "../desktop/src/dropped.ts";

const dir = mkdtempSync(join(tmpdir(), "kiwi-dropped-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("dropped images are read once into base64 with their type; anything else is refused with a reason, and a missing file is skipped", async () => {
  writeFileSync(join(dir, "shot.PNG"), "\x89PNG");
  writeFileSync(join(dir, "photo.jpeg"), "jpeg");
  writeFileSync(join(dir, "notes.txt"), "text");
  mkdirSync(join(dir, "folder.png"));
  writeFileSync(join(dir, "huge.webp"), "");
  truncateSync(join(dir, "huge.webp"), MAX_DROPPED_BYTES + 1);
  const got = await readDropped(["shot.PNG", "photo.jpeg", "notes.txt", "folder.png", "gone.gif", "huge.webp"].map((n) => join(dir, n)));
  expect(got).toEqual([
    { name: "shot.PNG", type: "image/png", data: Buffer.from("\x89PNG").toString("base64") },
    { name: "photo.jpeg", type: "image/jpeg", data: Buffer.from("jpeg").toString("base64") },
    { name: "notes.txt", refused: "notes.txt isn’t a PNG, JPEG, GIF, or WebP." },
    { name: "huge.webp", refused: "huge.webp is over 25 MB." },
  ]);
});

test("at most the composer's eight files are read", async () => {
  const many = Array.from({ length: MAX_DROPPED_FILES + 3 }, (_, i) => {
    const p = join(dir, `m${i}.gif`);
    writeFileSync(p, "GIF89a");
    return p;
  });
  expect((await readDropped(many)).length).toBe(MAX_DROPPED_FILES);
});
