import { afterEach, expect, test } from "bun:test";

const disk = new Map<string, string>();
let writes = 0;
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => disk.get(k) ?? null,
    setItem: (k: string, v: string) => {
      writes++;
      disk.set(k, v);
    },
    removeItem: (k: string) => void disk.delete(k),
  },
});
const { dropWrite, flushWrites, pendingWrite, WRITE_DELAY_MS, writeLater } = await import("./write-behind.ts");

afterEach(() => {
  flushWrites();
  disk.clear();
  writes = 0;
});

test("many writes to a key in a burst reach the disk once, with the last value, and read back before then", async () => {
  for (let i = 0; i < 50; i++) writeLater("mc.news", JSON.stringify({ seen: i }));
  writeLater("mc.places-seen.r", "{}");
  expect(writes).toBe(0);
  expect(pendingWrite("mc.news")).toBe(JSON.stringify({ seen: 49 }));
  await new Promise((r) => setTimeout(r, WRITE_DELAY_MS + 50));
  expect(writes).toBe(2);
  expect(disk.get("mc.news")).toBe(JSON.stringify({ seen: 49 }));
  expect(pendingWrite("mc.news")).toBeUndefined();
});

test("a flush writes at once, and a dropped write never lands", () => {
  writeLater("mc.recent.a", "1");
  writeLater("mc.recent.b", "2");
  dropWrite("mc.recent.b");
  flushWrites();
  expect(disk.get("mc.recent.a")).toBe("1");
  expect(disk.has("mc.recent.b")).toBe(false);
});
