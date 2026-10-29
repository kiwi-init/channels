import { describe, expect, test } from "bun:test";
import { readComputerSettings, type ComputerSettings } from "@kiwi/core/computer-settings.ts";
import type { HookRow } from "@kiwi/core/harnesses.ts";
import { readMachineArgs } from "@kiwi/core/machine-ask.ts";
import { wakeKey } from "@kiwi/core/wake.ts";
import type { ChannelConfig, Config } from "../src/config.ts";
import { remoteRunner } from "../src/daemon/remote.ts";
import { computerSettings } from "../src/daemon/settings.ts";

const channel = (title?: string): ChannelConfig => ({ roomId: "r", relay: "https://relay.example", code: "mc2-x", ...(title ? { title } : {}) }) as ChannelConfig;
const hooks: HookRow[] = [
  { harness: "claude", state: "installed", text: "installed" },
  { harness: "codex", state: "missing", text: "missing" },
];

describe("a computer's settings, as another of the person's devices reads them", () => {
  test("what it allows, where new agents open, its hooks and each agent's wake, without a webhook's address or header", () => {
    const cfg: Config = {
      channels: { dev: channel("channels-dev"), ops: channel() },
      bindings: {
        "/a": [
          { alias: "dev", as: "otter" },
          { alias: "ops", as: "orca" },
        ],
        "/b": { alias: "dev", as: "otter" },
        "/c": { alias: "gone", as: "ghost" },
        "/d": { alias: "dev", as: "heron" },
      },
      launch: "off",
      remoteBypass: "on",
      terminals: { helpers: { tmux: "on" } },
      wakeOff: [wakeKey("ops", "orca")],
      wakeHooks: { [wakeKey("dev", "heron")]: { url: "https://hook.example/secret", authorization: "Bearer s3cret" } },
    };
    const got = computerSettings(cfg, hooks);
    expect(got).toEqual({
      launch: "off",
      bypass: "on",
      hooks,
      seats: [
        { channel: "channels-dev", agent: "otter", wake: "on" },
        { channel: "ops", agent: "orca", wake: "off" },
        { channel: "channels-dev", agent: "heron", wake: "webhook" },
      ],
    });
    expect(JSON.stringify(got)).not.toContain("secret");
    expect(computerSettings({ channels: {} }, [])).toEqual({ launch: "on", bypass: "off", hooks: [], seats: [] });
  });

  test("read back only in its own shape: a bad switch or list is no answer, an older kiwi's terminal is dropped, and a bad row is dropped", () => {
    const good: ComputerSettings = { launch: "on", bypass: "on", hooks, seats: [{ channel: "dev", agent: "otter", wake: "webhook" }] };
    expect(readComputerSettings(good)).toEqual(good);
    expect(readComputerSettings({ ...good, bypass: undefined })).toEqual({ ...good, bypass: "off" });
    expect(readComputerSettings({ ...good, launch: "maybe" })).toBeNull();
    expect(readComputerSettings({ ...good, prefer: "app" })).toEqual(good);
    expect(readComputerSettings({ ...good, seats: "all" })).toBeNull();
    const rows = {
      ...good,
      hooks: [...hooks, { harness: "moon", state: "on" }],
      seats: [...good.seats, { channel: "dev", agent: "", wake: "on" }, { channel: "x".repeat(121), agent: "a", wake: "on" }, { channel: "dev", agent: "b", wake: "loud" }],
    };
    expect(readComputerSettings(rows)).toEqual(good);
  });

  test("asked for with no arguments, and answered only by a kiwi that shares them", async () => {
    expect(readMachineArgs({ verb: "settings", args: {} })).toEqual({ verb: "settings" });
    expect(readMachineArgs({ verb: "settings", args: { write: true } })).toBeNull();
    const deps = { inventory: async () => [], folders: () => [], launch: async () => ({ ok: false as const, why: "failed" as const, detail: "" }) };
    const settings: ComputerSettings = { launch: "on", bypass: "off", hooks: [], seats: [] };
    expect(await remoteRunner({ ...deps, settings: async () => settings })({ verb: "settings" }, "settingsAsk_1")).toEqual({ ok: true, settings });
    expect(await remoteRunner(deps)({ verb: "settings" }, "settingsAsk_2")).toEqual({ ok: false, why: "failed", detail: "this computer's kiwi doesn't share its settings" });
  });
});
