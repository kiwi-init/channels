import { describe, expect, test } from "bun:test";
import { PLACE_NAMES, readPlacedSeat, readRexSeat, readRexStatus, readShowResult, REX_UNKNOWN, type PlacedSeat, type RexStatus, type ShowResult } from "@kiwi/core/terminals.ts";

const rex = { server: "unix:///tmp/rex.sock", session: "session:0b0a5c1e-0000-4000-8000-000000000001", block: "block:0b0a5c1e-0000-4000-8000-000000000002" };

test("each place is named the same in the CLI and the app", () => {
  expect(PLACE_NAMES).toEqual({ rex: "Rex", tmux: "tmux" });
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

  test("a seat in the person's tmux reads back with its socket and pane, and a pane or socket tmux wouldn't give is refused", () => {
    const pane: PlacedSeat = { place: "tmux", alias: seat.alias, agent: seat.agent, room: "abc", socket: "/private/tmp/tmux-501/default", pane: "%12" };
    expect(readPlacedSeat(JSON.parse(JSON.stringify(pane)))).toEqual(pane);
    for (const bad of [
      { ...pane, pane: "12" },
      { ...pane, pane: "%1;rm" },
      { ...pane, socket: "tmp/default" },
      { ...pane, socket: "/tmp/a\nb" },
      { ...pane, place: "rex" },
      { ...pane, place: "terminal" },
      { ...pane, place: "hosted" },
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
