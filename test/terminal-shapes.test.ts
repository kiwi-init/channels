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
import { hostedWhere, launchedText } from "../src/launch/wire.ts";

const launch = "AbCdEfGhIjKlMnOpQrStUv";
const rex = { server: "unix:///tmp/rex.sock", session: "session:0b0a5c1e-0000-4000-8000-000000000001", block: "block:0b0a5c1e-0000-4000-8000-000000000002" };
const bare: Opened = { ok: true, place: "hosted", socket: "/tmp/kiwi-501/0123456789ab", window: "@3", pane: "%3" };
const places: Opened[] = [{ ...bare, pid: 43 }, bare];

const opened = (placed: Record<string, unknown>): unknown => ({ ok: true, launch, placed: { ok: true, ...placed } });

describe("a launch's answer", () => {
  test("a window in Channels' own tmux reads back as the daemon sent it", () => {
    for (const placed of places) {
      const sent: Launched = { ok: true, launch, placed };
      expect(readLaunched(JSON.parse(JSON.stringify(sent)))).toEqual(sent);
    }
    expect(launchedView({ ok: true, launch, placed: places[0] })).toEqual({ ok: true, launch, place: "hosted", window: "@3" });
  });

  test("each place is named the same in the CLI and the app, and the CLI says how to watch it with Channels' own tmux", () => {
    expect(PLACE_NAMES).toEqual({ rex: "Rex", tmux: "tmux", hosted: "Channels" });
    expect(launchedText({ ok: true, launch, placed: bare })).toMatch(
      new RegExp(`^started in Channels' own tmux, window @3 \\(to watch it: \\S+ -S /tmp/kiwi-501/0123456789ab attach -t _kiwi\\); it joins with launch ${launch}$`),
    );
    expect(hostedWhere(bare, "/Users/someone/.kiwi/tmux/tmux-3.6a")).toBe(
      "Channels' own tmux, window @3 (to watch it: /Users/someone/.kiwi/tmux/tmux-3.6a -S /tmp/kiwi-501/0123456789ab attach -t _kiwi)",
    );
    expect(hostedWhere({ ...bare, socket: "/tmp/a dir/s" }, "/Apps/My Tools/tmux")).toBe("Channels' own tmux, window @3 (to watch it: '/Apps/My Tools/tmux' -S '/tmp/a dir/s' attach -t _kiwi)");
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
    expect(launchedText({ ok: false, why: "no-place", detail: "hosted agents need tmux 3.2 or newer" })).toBe("hosted agents need tmux 3.2 or newer");
  });

  test("a place other than Channels' own tmux, a bad launch id, an oversized or missing field is no launch at all", () => {
    for (const bad of [
      undefined,
      null,
      "started",
      [],
      { ok: "yes" },
      { launch, placed: bare },
      { ok: true, launch, placed: { ...bare, ok: false } },
      { ok: true, launch, placed: null },
      { ok: true, launch: "short", placed: bare },
      { ok: true, launch: "has spaces in it", placed: bare },
      opened({ place: "screen" }),
      opened({ place: "terminal", window: 12 }),
      opened({ place: "rex", rex, window: "window:3" }),
      opened({ place: "tmux", socket: "/tmp/s", session: "kiwi", window: "@4", pane: "%4" }),
      opened({ place: "hosted", socket: "/tmp/s", window: "@".repeat(33), pane: "%4" }),
      opened({ place: "hosted", window: "@4", pane: "%4" }),
      opened({ place: "hosted", socket: "/tmp/s", window: "@4" }),
    ]) {
      expect(readLaunched(bad)).toBeNull();
      expect(launchedView(bad)).toEqual({ ok: false, why: "failed", detail: "the daemon answered a launch in a shape this app doesn't know" });
    }
  });

  test("a pid that isn't one is left out, the place kept", () => {
    expect(readLaunched(opened({ ...bare, pid: 1.5, extra: true }))).toEqual({ ok: true, launch, placed: bare });
    expect(readLaunched(opened({ ...bare, pid: -1 }))).toEqual({ ok: true, launch, placed: bare });
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

  test("a seat in Channels' own tmux or the person's reads back with its socket and pane, and a pane or socket tmux wouldn't give is refused", () => {
    const pane: PlacedSeat = { place: "hosted", alias: seat.alias, agent: seat.agent, room: "abc", socket: "/private/tmp/tmux-501/default", pane: "%12" };
    expect(readPlacedSeat(JSON.parse(JSON.stringify(pane)))).toEqual(pane);
    expect(readPlacedSeat({ ...pane, place: "tmux" })).toEqual({ ...pane, place: "tmux" });
    for (const bad of [
      { ...pane, pane: "12" },
      { ...pane, pane: "%1;rm" },
      { ...pane, socket: "tmp/default" },
      { ...pane, socket: "/tmp/a\nb" },
      { ...pane, place: "rex" },
      { ...pane, place: "terminal" },
    ])
      expect(readPlacedSeat(bad)).toBeNull();
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
