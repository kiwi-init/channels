import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const SOURCES = ["ui/src", "ios/Channels", "android/app/src/main"];
const CODE = /\.(tsx?|swift|kt)$/;

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : files(path);
    return CODE.test(name) && !name.includes(".test.") ? [path] : [];
  });

const read = (path: string): string => readFileSync(join(root, path), "utf8");

describe("direct messages never claim to be private: every member of the channel can read them", () => {
  test("no app says a DM is read only by the two people in it, or is sent privately", () => {
    const claims = /Only you and\b|\bprivately\b|only the two of you/i;
    const found = SOURCES.flatMap((dir) => files(join(root, dir)))
      .filter((path) => claims.test(readFileSync(path, "utf8")))
      .map((path) => path.slice(root.length + 1));
    expect(found).toEqual([]);
  });

  test("an empty DM on the desktop says who can read it", () => {
    expect(read("ui/src/chat/conversation.tsx")).toContain("This is the start of your messages with ${nickname(channel, where.with)}. Everyone in the channel can read them.");
  });

  test("the phones' lead chat says who can read it", () => {
    expect(read("ios/Channels/Views/Conversation.swift")).toContain('"Everyone in the channel can read this"');
    expect(read("android/app/src/main/java/com/kiwiinit/channels/ui/Conversation.kt")).toContain('"Everyone in the channel can read this"');
  });
});
