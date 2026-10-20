import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChannelConfig, Config } from "../src/config.ts";
import { seatFolders } from "../src/launch/folders.ts";

const dir = mkdtempSync(join(tmpdir(), "kiwi-folders-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const folder = (name: string): string => {
  const path = join(dir, name);
  mkdirSync(path, { recursive: true });
  return path;
};

const channel = (roomId: string): ChannelConfig => ({ roomId, relay: "https://relay.example", code: "mc2-x" }) as ChannelConfig;

describe("the folders a channel's seats work in on this computer", () => {
  test("most recently seen first, one per folder, only this channel's, only folders that still exist", () => {
    const app = folder("app");
    const site = folder("site");
    const other = folder("other");
    const cfg: Config = {
      channels: { dev: channel("room-dev"), ops: channel("room-ops") },
      bindings: {
        [app]: [
          { alias: "dev", as: "otter", at: 10, seen: 50 },
          { alias: "dev", as: "llama", at: 20 },
        ],
        [site]: { alias: "dev", as: "marmot", at: 5, seen: 90 },
        [other]: { alias: "ops", as: "orca", seen: 100 },
        [join(dir, "gone")]: { alias: "dev", as: "ghost", seen: 200 },
      },
    };
    expect(seatFolders(cfg, "room-dev")).toEqual([site, app]);
    expect(seatFolders(cfg, "room-ops")).toEqual([other]);
    expect(seatFolders(cfg)).toEqual([other, site, app]);
    expect(seatFolders({ channels: {} }, "room-dev")).toEqual([]);
  });
});
