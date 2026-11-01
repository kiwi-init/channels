import { describe, expect, test } from "bun:test";
import type { PlacedSeat, ShowResult } from "@kiwi/core/terminals.ts";
import type { Config } from "../src/config.ts";
import type { Capability, PlaceTools, SeatPlace, TerminalId, TerminalManifest, TerminalPlugin } from "../src/terminals/plugin.ts";
import { MANIFESTS, seatPlaces, showSeat, terminalPlugins } from "../src/terminals/registry.ts";
import { rexManifest } from "../src/terminals/rex/manifest.ts";

const tools = (over: Partial<PlaceTools> = {}): PlaceTools => ({ platform: "darwin", shell: "/bin/zsh", rex: null, tmux: null, ...over });

describe("the terminal plugins", () => {
  test("each has its own id, a name, the platforms it runs on, and only the capabilities it implements", async () => {
    const ids = MANIFESTS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MANIFESTS) {
      expect(m.id).toMatch(/^[a-z][a-z0-9-]{1,31}$/);
      expect(m.name.trim()).not.toBe("");
      expect(m.platforms.length).toBeGreaterThan(0);
      expect(new Set(m.can).size).toBe(m.can.length);
    }
    const implemented = (p: TerminalPlugin): Record<Capability, boolean> => ({
      locate: !!p.locate,
      mark: !!p.mark,
      show: !!p.show,
      watch: !!p.watch && !!p.activity,
      type: !!p.type,
    });
    for (const plugin of await terminalPlugins(tools())) {
      const has = implemented(plugin);
      for (const can of Object.keys(has) as Capability[]) expect([plugin.manifest.id, can, has[can]]).toEqual([plugin.manifest.id, can, plugin.manifest.can.includes(can)]);
      expect(!!plugin.helpers).toBe(plugin.manifest.helpers !== null);
    }
  });

  test("Rex and tmux are the terminals, and neither opens a new agent's window: Channels' own tmux does", async () => {
    expect(MANIFESTS.map((m) => m.id)).toEqual(["rex", "tmux"]);
    expect((await terminalPlugins(tools())).map((p) => p.manifest.id)).toEqual(["rex", "tmux"]);
    expect((await terminalPlugins(tools({ platform: "win32" }))).map((p) => p.manifest.id)).toEqual(["rex"]);
    for (const plugin of await terminalPlugins(tools())) expect(Object.keys(plugin)).not.toContain("open");
  });

  test("a terminal that isn't on this computer is neither found nor running", async () => {
    for (const plugin of await terminalPlugins(tools())) expect(await plugin.detect()).toEqual({ found: false, running: false });
  });
});

describe("seats a terminal can show", () => {
  const place = { server: "studio", session: "session:01a15963-bacc-7426-91e9-4d98757dcd0c", block: "block:11a15963-bacc-7426-91e9-4d98757dcd0c" };
  const seat: PlacedSeat = { place: "rex", alias: "ch", agent: "ana", room: "room-1", ...place };
  const helpers = (rex: "on" | "off"): Config => ({ channels: {}, terminals: { helpers: { rex } } });
  const everywhere = (m: TerminalManifest, can: TerminalManifest["can"]): TerminalManifest => ({ ...m, platforms: ["darwin", "linux", "win32"], can });

  function terminals(...plugins: { manifest: TerminalManifest; seats: PlacedSeat[]; answer?: ShowResult }[]) {
    const loaded: TerminalId[] = [];
    const shown: Record<string, SeatPlace[]> = {};
    const made = plugins.map(({ manifest, seats, answer }): TerminalPlugin => ({
      manifest,
      detect: async () => ({ found: true, running: true }),
      seats: () => seats,
      show: async (at) => {
        (shown[manifest.id] ??= []).push(at);
        return answer ?? { ok: true };
      },
    }));
    const load = async (id: TerminalId): Promise<TerminalPlugin> => {
      loaded.push(id);
      const plugin = made.find((p) => p.manifest.id === id);
      if (!plugin) throw new Error(`no plugin ${id}`);
      return plugin;
    };
    return { from: { manifests: made.map((p) => p.manifest), load }, loaded, shown };
  }

  test("a seat is listed by the terminal it runs in, once that terminal's helpers are on", async () => {
    const on = terminals({ manifest: everywhere(rexManifest, ["locate", "show"]), seats: [seat] });
    expect(await seatPlaces(helpers("on"), on.from)).toEqual([seat]);
    const off = terminals({ manifest: everywhere(rexManifest, ["locate", "show"]), seats: [seat] });
    expect(await seatPlaces(helpers("off"), off.from)).toEqual([]);
    expect(off.loaded).toEqual([]);
  });

  test("a terminal that can't show isn't loaded: its seats aren't listed and showing one shows nothing", async () => {
    const t = terminals({ manifest: everywhere(rexManifest, ["locate", "type"]), seats: [seat] });
    expect(await seatPlaces(helpers("on"), t.from)).toEqual([]);
    expect(await showSeat(seat, helpers("on"), t.from)).toEqual({ ok: false, why: "failed" });
    expect(t.loaded).toEqual([]);
    expect(t.shown).toEqual({});
  });

  test("Show goes to the terminal the seat runs in, found by its place and not its name, and says that terminal's answer", async () => {
    const t = terminals({ manifest: everywhere(rexManifest, ["locate", "show"]), seats: [seat], answer: { ok: false, why: "no-app" } });
    expect(await showSeat({ ...seat, alias: "kiwi", agent: "agent" }, helpers("off"), t.from)).toEqual({ ok: false, why: "no-app" });
    expect(t.shown).toEqual({ rex: [{ rex: place }] });
    expect(await showSeat({ ...seat, block: "block:21a15963-bacc-7426-91e9-4d98757dcd0c" }, helpers("on"), t.from)).toEqual({ ok: false, why: "failed" });
    expect(t.shown).toEqual({ rex: [{ rex: place }] });
  });
});
