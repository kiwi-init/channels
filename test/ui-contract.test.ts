import { describe, expect, test } from "bun:test";
import { makeBridge } from "../desktop/src/calls.ts";
import type { StoreSnapshot } from "../desktop/src/bridge.ts";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CHANNEL_CALLS } from "../desktop/src/bridge.ts";
import { CHANNEL_CALLS_BACKGROUND, CHANNEL_CALLS_SINCE, UI_CONTRACT, UI_REQUIRES, UI_SURFACES } from "../desktop/src/ui-contract.ts";

const snapshot: StoreSnapshot = { relayUrl: "https://relay.example", person: null, channels: [], computers: [], phones: [], pending: [], personalities: [] };

function surface(): string[] {
  const pushes = new Set<string>();
  const bridge = makeBridge({
    snapshot,
    channels: { request: () => new Promise(() => {}), onPush: () => () => {}, onRestart: () => () => {} },
    listen: (name) => (pushes.add(name), () => {}),
    call: () => new Promise(() => {}),
  });
  for (const [name, member] of Object.entries(bridge)) if (/^on[A-Z]/.test(name) && typeof member === "function") member(() => {});
  return [...Object.keys(bridge).map((name) => `kiwi.${name}`), ...[...pushes].map((name) => `push:${name}`)].sort();
}

const semver = (v: string): [number, number, number] => {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(v);
  if (!m) throw new Error(`${v} isn't x.y.z`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

const newer = (a: string, b: string): number => {
  const [x, y] = [semver(a), semver(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

describe("the UI contract", () => {
  test("UI_CONTRACT names what window.kiwi offers: a bridge change needs a new UI_SURFACES entry and version", () => {
    expect(surface()).toEqual([...(UI_SURFACES[UI_CONTRACT] ?? [])]);
  });

  test("UI_CONTRACT is the newest version listed", () => {
    expect(Object.keys(UI_SURFACES).sort(newer).at(-1)).toBe(UI_CONTRACT);
  });

  test("published UIs ask for a contract the app lists, no newer than its own and in the same major version", () => {
    expect(UI_SURFACES[UI_REQUIRES]).toBeDefined();
    expect(newer(UI_REQUIRES, UI_CONTRACT)).toBeLessThanOrEqual(0);
    expect(semver(UI_REQUIRES)[0]).toBe(semver(UI_CONTRACT)[0]);
  });

  test("within a major version, every later surface keeps all the names of the earlier ones", () => {
    const versions = Object.keys(UI_SURFACES).sort(newer);
    for (const [i, later] of versions.entries())
      for (const earlier of versions.slice(0, i)) {
        if (semver(earlier)[0] !== semver(later)[0]) continue;
        const dropped = (UI_SURFACES[earlier] ?? []).filter((name) => !(UI_SURFACES[later] ?? []).includes(name));
        expect({ earlier, later, dropped }).toEqual({ earlier, later, dropped: [] });
      }
  });

  test("a channel call newer than contract 1.10.0 is listed, and the UI checks the app serves it before using it (#1118)", () => {
    const CALLS_AT_1_10 = 46;
    const total: number = CHANNEL_CALLS.length;
    expect(total).toBe(CALLS_AT_1_10 + Object.values(CHANNEL_CALLS_SINCE).flat().length);
    for (const v of Object.keys(CHANNEL_CALLS_SINCE)) expect(UI_SURFACES[v]).toBeDefined();
    const ui = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? ui(p) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [readFileSync(p, "utf8")] : [];
      });
    const source = ui(join(import.meta.dir, "../ui/src")).join("\n");
    const unchecked = Object.values(CHANNEL_CALLS_SINCE)
      .flat()
      .filter((call) => !CHANNEL_CALLS_BACKGROUND.includes(call) && !new RegExp(`(useAppCan|appCan)\\("${call}"\\)`).test(source));
    expect(unchecked).toEqual([]);
  });

  test("CHANNEL_CALLS holds every listed newer call, so a call can't be listed and then dropped", () => {
    for (const call of Object.values(CHANNEL_CALLS_SINCE).flat()) expect(CHANNEL_CALLS as readonly string[]).toContain(call);
  });
});
