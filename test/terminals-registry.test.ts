import { describe, expect, test } from "bun:test";
import type { PlaceTools } from "../src/terminals/plugin.ts";
import { MANIFESTS, terminalPlugins } from "../src/terminals/registry.ts";

const tools = (over: Partial<PlaceTools> = {}): PlaceTools => ({ platform: "darwin", shell: "/bin/zsh", rex: null, tmux: null, osascript: null, ...over });

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
    for (const plugin of await terminalPlugins(tools())) expect(typeof plugin.open === "function").toBe(plugin.manifest.can.includes("open"));
  });

  test("a new agent's window is tried in Rex, then tmux, then the terminal app, and the app only on a Mac", async () => {
    expect(MANIFESTS.map((m) => m.id)).toEqual(["rex", "tmux", "app"]);
    expect((await terminalPlugins(tools())).map((p) => p.manifest.id)).toEqual(["rex", "tmux", "app"]);
    expect((await terminalPlugins(tools({ platform: "linux" }))).map((p) => p.manifest.id)).toEqual(["rex", "tmux"]);
  });

  test("a terminal that isn't on this computer is neither found nor running, and opening it says so", async () => {
    const request = { argv: ["claude"], folder: "/tmp", name: "claude" };
    for (const plugin of await terminalPlugins(tools())) {
      expect(await plugin.detect()).toEqual({ found: false, running: false });
      expect(await plugin.open?.(request)).toMatchObject({ ok: false, why: "no-place" });
    }
  });
});
