import { describe, expect, test } from "bun:test";
import {
  PLACE_NAMES,
  readLaunched,
  readPlacedSeat,
  readRexSeat,
  readRexStatus,
  readShowResult,
  REX_UNKNOWN,
  type Launched,
  type Opened,
  type PlacedSeat,
  type RexStatus,
  type ShowResult,
} from "@kiwi/core/terminals.ts";
import { launchedView } from "../desktop/src/launch-view.ts";
import { launchedText } from "../src/launch/wire.ts";

const launch = "AbCdEfGhIjKlMnOpQrStUv";
const rex = { server: "unix:///tmp/rex.sock", session: "session:0b0a5c1e-0000-4000-8000-000000000001", block: "block:0b0a5c1e-0000-4000-8000-000000000002" };
const places: Opened[] = [
  { ok: true, place: "rex", rex, window: "window:3", pid: 41 },
  { ok: true, place: "rex", rex, window: "window:3" },
  { ok: true, place: "tmux", socket: "/private/tmp/tmux-501/default", session: "kiwi", window: "@7", pane: "%7", pid: 42 },
  { ok: true, place: "tmux", socket: "/private/tmp/tmux-501/default", session: "kiwi", window: "@7", pane: "%7" },
  { ok: true, place: "terminal", window: 12 },
  { ok: true, place: "terminal" },
];

const opened = (placed: Record<string, unknown>): unknown => ({ ok: true, launch, placed: { ok: true, ...placed } });

describe("a launch's answer", () => {
  test("every place kind reads back as the daemon sent it", () => {
    for (const placed of places) {
      const sent: Launched = { ok: true, launch, placed };
      expect(readLaunched(JSON.parse(JSON.stringify(sent)))).toEqual(sent);
    }
    expect(places.map((p) => p.place).filter((kind, i, all) => all.indexOf(kind) === i)).toEqual(["rex", "tmux", "terminal"]);
    expect(Object.keys(PLACE_NAMES)).toEqual(["rex", "tmux", "terminal"]);
  });

  test("each place is named the same in the CLI and the app", () => {
    expect(PLACE_NAMES).toEqual({ rex: "Rex", tmux: "tmux", terminal: "Terminal" });
    expect(launchedText({ ok: true, launch, placed: places[0]! })).toBe(`started in a Rex window; it joins with launch ${launch}`);
    expect(launchedText({ ok: true, launch, placed: places[2]! })).toBe(`started in tmux window @7 of session kiwi (tmux attach -t kiwi); it joins with launch ${launch}`);
    expect(launchedText({ ok: true, launch, placed: places[5]! })).toBe(`started in a Terminal window; it joins with launch ${launch}`);
  });

  test("a refusal keeps its reason and its words, an unknown reason is a failure", () => {
    for (const why of ["bad-request", "not-installed", "no-recipe", "no-place", "not-allowed", "failed"] as const) {
      expect(readLaunched({ ok: false, why, detail: "install tmux" })).toEqual({ ok: false, why, detail: "install tmux" });
    }
    expect(readLaunched({ ok: false, why: "exploded", detail: "a newer daemon's reason" })).toEqual({ ok: false, why: "failed", detail: "a newer daemon's reason" });
    expect(readLaunched({ ok: false, why: "no-place", detail: 7 })).toEqual({ ok: false, why: "no-place", detail: "" });
    const long = `${"/a".repeat(300)} isn't a folder`;
    expect(readLaunched({ ok: false, why: "bad-request", detail: long })).toEqual({ ok: false, why: "bad-request", detail: long });
    expect(launchedView({ ok: false, why: "bad-request", detail: long })).toEqual({ ok: false, why: "bad-request", detail: "" });
  });

  test("an unknown place, a bad launch id, an oversized or missing field is no launch at all", () => {
    for (const bad of [
      undefined,
      null,
      "started",
      [],
      { ok: "yes" },
      { launch, placed: { ok: true, place: "terminal" } },
      { ok: true, launch, placed: { ok: false, place: "terminal" } },
      { ok: true, launch, placed: null },
      { ok: true, launch: "short", placed: { ok: true, place: "terminal" } },
      { ok: true, launch: "has spaces in it", placed: { ok: true, place: "terminal" } },
      opened({ place: "screen" }),
      opened({ place: "rex", rex, window: "" }),
      opened({ place: "rex", rex: { ...rex, server: "s".repeat(513) }, window: "window:3" }),
      opened({ place: "rex", rex: { ...rex, block: 2 }, window: "window:3" }),
      opened({ place: "rex", window: "window:3" }),
      opened({ place: "tmux", socket: "/tmp/s", session: "k".repeat(129), window: "@4", pane: "%4" }),
      opened({ place: "tmux", socket: "/tmp/s", session: "kiwi", window: "@".repeat(33), pane: "%4" }),
      opened({ place: "tmux", session: "kiwi", window: "@4", pane: "%4" }),
      opened({ place: "tmux", socket: "/tmp/s", session: "kiwi", window: "@4" }),
    ]) {
      expect(readLaunched(bad)).toBeNull();
      expect(launchedView(bad)).toEqual({ ok: false, why: "failed", detail: "the daemon answered a launch in a shape this app doesn't know" });
    }
  });

  test("a pid or a window number that isn't one is left out, the place kept", () => {
    expect(readLaunched(opened({ place: "terminal", window: "12" }))).toEqual({ ok: true, launch, placed: { ok: true, place: "terminal" } });
    expect(readLaunched(opened({ place: "terminal", window: -1 }))).toEqual({ ok: true, launch, placed: { ok: true, place: "terminal" } });
    expect(readLaunched(opened({ place: "rex", rex: { ...rex, extra: 1 }, window: "window:3", pid: 1.5, extra: true }))).toEqual({
      ok: true,
      launch,
      placed: { ok: true, place: "rex", rex, window: "window:3" },
    });
  });
});

describe("Rex's status", () => {
  test("kiwi rex status --json reads back whole", () => {
    const status: RexStatus = { found: true, version: "0.0.1792433367-g93d474", server: "running", helpers: "on", rotation: "off" };
    expect(readRexStatus(JSON.parse(JSON.stringify(status)))).toEqual(status);
    expect(readRexStatus({ found: true, server: "stopped", helpers: "off", rotation: "on" })).toEqual({ found: true, server: "stopped", helpers: "off", rotation: "on" });
  });

  test("anything else reads as Rex not found, field by field", () => {
    expect(readRexStatus({ found: "yes", version: "has spaces", server: "up", helpers: true, rotation: 1 })).toEqual(REX_UNKNOWN);
    expect(readRexStatus({ found: true, version: "v".repeat(65), server: "running", helpers: "on", rotation: "on" })).toEqual({ found: true, server: "running", helpers: "on", rotation: "on" });
    for (const bad of [undefined, null, "Rex isn't installed on this computer", 3, [], [{ found: true }]]) expect(readRexStatus(bad)).toEqual(REX_UNKNOWN);
  });
});

describe("a Rex seat", () => {
  const seat = { alias: "kiwi", agent: "claude", room: "0123456789abcdef0123456789abcdef", ...rex };

  test("a seat reads back as kiwi rex seats --json wrote it, its room optional", () => {
    expect(readRexSeat(JSON.parse(JSON.stringify(seat)))).toEqual(seat);
    const roomless = { alias: seat.alias, agent: seat.agent, ...rex };
    expect(readRexSeat(roomless)).toEqual(roomless);
    expect(readRexSeat({ ...seat, room: "r".repeat(129) })).toEqual(roomless);
    expect(readRexSeat({ ...seat, extra: "dropped" })).toEqual(seat);
  });

  test("a seat missing a field, or with one too long, is refused whole", () => {
    for (const over of [
      { alias: "" },
      { alias: "a".repeat(201) },
      { agent: "a".repeat(65) },
      { agent: undefined },
      { server: "s".repeat(513) },
      { session: 1 },
      { block: "b".repeat(129) },
      { block: undefined },
    ]) {
      expect(readRexSeat({ ...seat, ...over })).toBeNull();
    }
    for (const bad of [undefined, null, "kiwi claude block:1", [seat]]) expect(readRexSeat(bad)).toBeNull();
  });
});

describe("a seat in a terminal that can show it", () => {
  const seat: PlacedSeat = { place: "rex", alias: "kiwi", agent: "claude", room: "0123456789abcdef0123456789abcdef", ...rex };

  test("a seat reads back as kiwi terminal seats --json wrote it, its terminal kept and its room optional", () => {
    expect(readPlacedSeat(JSON.parse(JSON.stringify(seat)))).toEqual(seat);
    const roomless: PlacedSeat = { place: "rex", alias: seat.alias, agent: seat.agent, ...rex };
    expect(readPlacedSeat(roomless)).toEqual(roomless);
    expect(readPlacedSeat({ ...seat, extra: "dropped" })).toEqual(seat);
  });

  test("a seat without its terminal, in a terminal that can't show it, or missing a field is refused whole", () => {
    const unplaced = { alias: seat.alias, agent: seat.agent, room: seat.room, ...rex };
    expect(readRexSeat(unplaced)).not.toBeNull();
    for (const bad of [
      unplaced,
      { ...seat, place: "tmux" },
      { ...seat, place: "terminal" },
      { ...seat, place: "Rex" },
      { ...seat, block: undefined },
      { ...seat, agent: "a".repeat(65) },
      null,
      [seat],
    ]) {
      expect(readPlacedSeat(bad)).toBeNull();
    }
  });
});

describe("a show's answer", () => {
  test("Shown, or not with its reason, reads back as kiwi terminal show printed it", () => {
    const answers: ShowResult[] = [{ ok: true }, ...(["no-rex", "no-server", "no-app", "remote-control", "failed"] as const).map((why): ShowResult => ({ ok: false, why }))];
    for (const said of answers) expect(readShowResult(JSON.parse(JSON.stringify(said)))).toEqual(said);
  });

  test("a reason it doesn't know, or an answer that isn't one, is a failure", () => {
    for (const bad of [{ ok: false, why: "exploded" }, { ok: false }, { ok: "yes" }, [{ ok: true }], "ok", null, undefined]) {
      expect(readShowResult(bad)).toEqual({ ok: false, why: "failed" });
    }
  });
});
