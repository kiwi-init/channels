import { describe, expect, test } from "bun:test";

import { MAX_ROOM_NAME, MAX_ROOMS, type Event, type Message } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { cleanRoomName, roomLast, roomOfMessage, roomProblem, roomSeenKey, roomsAfter, roomUnread } from "./rooms";

const general = { id: "general", name: "general" };
const desktop = { id: "k3x9a1b2", name: "desktop" };

describe("a room the owner makes or renames from channel settings (T987)", () => {
  test("its name is what the fold keeps: no leading #, spaces folded, at most 40 characters", () => {
    expect(cleanRoomName("#mobile")).toBe("mobile");
    expect(cleanRoomName("  ##iOS   builders ")).toBe("iOS builders");
    expect(cleanRoomName("x".repeat(60)).length).toBe(MAX_ROOM_NAME);
    expect(cleanRoomName("# #mobile")).toBe("mobile");
    for (const typed of ["# #mobile", " ## iOS  builders", "x".repeat(60), "#a #b"]) expect(cleanRoomName(cleanRoomName(typed))).toBe(cleanRoomName(typed));
  });

  test("a name typed with more #s and spaces is the same name: refused when taken, and signed exactly as the event sends it", () => {
    const mobile = { id: "m0b1le00", name: "mobile" };
    expect(roomProblem([general, mobile], "# #mobile")).toBe("A room is already called #mobile");
    const sent = { id: "n3w00000", name: cleanRoomName("#a #b") };
    expect(roomsAfter([general], sent)).toEqual([general, sent]);
  });

  test("is refused before it's sent for what the fold would refuse: no name, a name taken in any case, too many rooms", () => {
    expect(roomProblem([general, desktop], "  # ")).toBe("A room needs a name");
    expect(roomProblem([general, desktop], "Desktop")).toBe("A room is already called #Desktop");
    expect(roomProblem([general, desktop], "mobile")).toBeNull();
    expect(roomProblem([general, desktop], "DESKTOP", desktop.id)).toBeNull();
    expect(roomProblem([general, desktop], "general", desktop.id)).toBe("A room is already called #general");
    const full = Array.from({ length: MAX_ROOMS }, (_, i) => ({ id: `r${i}`, name: `room-${i}` }));
    expect(roomProblem(full, "one more")).toBe(`A channel holds at most ${MAX_ROOMS} rooms`);
    expect(roomProblem(full, "renamed", "r3")).toBeNull();
  });

  test("signs the room list as it is after the change, #general always in it", () => {
    expect(roomsAfter([general, desktop], { id: "m0b1le00", name: cleanRoomName("#mobile") })).toEqual([general, desktop, { id: "m0b1le00", name: "mobile" }]);
    expect(roomsAfter([general, desktop], { id: desktop.id, name: "electrobun" })).toEqual([general, { id: desktop.id, name: "electrobun" }]);
    expect(roomsAfter([general, desktop], { id: "general", name: "lobby" })).toEqual([{ id: "general", name: "lobby" }, desktop]);
    expect(roomsAfter([{ id: "general", name: "lobby" }, desktop], { id: "general", name: "general" })).toEqual([general, desktop]);
  });

  test("#general renamed back to general stays general after the owner's next room change, for a client folding from a base saved while it was lobby (T1236)", () => {
    const roster: Roster = [{ name: "ana", pk: "pk-ana", owner: true, at: 0, active: true }];
    const T = 1_760_000_000_000;
    const ev = (seq: number, e: Event): Message => ({ v: 1, seq, id: `e${seq}`, rts: T + seq, ts: T + seq, from: "ana", pk: "pk-ana", sig: "s", sigOk: true, kind: "event", body: "", ev: e });
    let base: FoldBase | null = null;
    fold([ev(1, { op: "room.rename", id: "general", name: "lobby" })], roster, T + 10, null, null, null, (b) => (base = b));
    const back = fold([ev(1, { op: "room.rename", id: "general", name: "lobby" }), ev(2, { op: "room.rename", id: "general", name: "general" })], roster, T + 10);
    const mobile = { id: "m0b1le00", name: "mobile" };
    const list = roomsAfter(back.rooms.values(), mobile);
    const fromBase = fold([], roster, T + 10, { list, since: 3 }, null, base);
    expect(fromBase.rooms.get("general")?.name).toBe("general");
    expect(fromBase.rooms.get(mobile.id)?.name).toBe("mobile");
  });
});

describe("a room is its own conversation (T1030)", () => {
  test("a message is in the room the fold put it in, one still sending in the room it was sent to, and anything else in #general", () => {
    const state = { roomOf: new Map([[7, "k3x9a1b2"]]) };
    expect(roomOfMessage(state, { seq: 7 })).toBe("k3x9a1b2");
    expect(roomOfMessage(state, { seq: 7, room: "other" })).toBe("k3x9a1b2");
    expect(roomOfMessage(state, { seq: -3, room: "k3x9a1b2" })).toBe("k3x9a1b2");
    expect(roomOfMessage(state, { seq: 8 })).toBe("general");
  });
});

describe("each room has its own unread count and read mark (T1236)", () => {
  const roster: Roster = [
    { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true },
    { name: "atlas", pk: "pk-atlas", owner: false, at: 0, active: true },
  ];
  const T = 1_760_000_000_000;
  const said = (seq: number, from: string, body: string, rest: Partial<Message> = {}): Message => ({
    seq,
    v: 1,
    kind: "msg",
    id: `m${seq}`,
    rts: T + seq,
    ts: T + seq,
    from,
    pk: `pk-${from}`,
    sig: "s",
    sigOk: true,
    body,
    ...rest,
  });
  const messages = [
    said(1, "jow", "", { kind: "event", ev: { op: "room.create", id: "m0b1le00", name: "mobile" } }),
    said(2, "atlas", "in general"),
    said(3, "atlas", "@jow the iOS build is red", { room: "m0b1le00", to: ["jow"] }),
    said(4, "atlas", "and a second one", { room: "m0b1le00" }),
    said(5, "atlas", "back in general"),
  ];
  const state = fold(messages, roster, T + 100);

  test("a message counts in its own room only, so an @jow in #mobile doesn't mark #general", () => {
    const unread = roomUnread(state, messages, "jow", {}, 0);
    expect(unread("general")).toEqual({ n: 2, forMe: true });
    expect(unread("m0b1le00")).toEqual({ n: 2, forMe: true });
    expect(roomUnread(state, messages, "jow", { main: 5 }, 0)("m0b1le00")).toEqual({ n: 2, forMe: true });
    expect(roomUnread(state, messages, "jow", { main: 5 }, 0)("general")).toEqual({ n: 0, forMe: false });
  });

  test("opening a room marks it read up to its own last message, not the channel's, under its own key (#general keeps main)", () => {
    expect(roomLast(state, messages)).toEqual(
      new Map([
        ["general", 5],
        ["m0b1le00", 4],
      ]),
    );
    expect(roomSeenKey("general")).toBe("main");
    expect(roomSeenKey("m0b1le00")).toBe("room:m0b1le00");
    expect(roomUnread(state, messages, "jow", { "room:m0b1le00": 4 }, 0)("m0b1le00")).toEqual({ n: 0, forMe: false });
    expect(roomUnread(state, messages, "jow", { "room:m0b1le00": 4 }, 0)("general")).toEqual({ n: 2, forMe: true });
  });

  test("after the update, a room with no mark of its own starts from the main mark the single feed left (frozen once), so nothing it already showed comes back unread; later messages still count", () => {
    expect(roomUnread(state, messages, "jow", { main: 5 }, 5)("m0b1le00")).toEqual({ n: 0, forMe: false });
    expect(roomUnread(state, messages, "jow", { main: 3 }, 3)("m0b1le00")).toEqual({ n: 1, forMe: true });
    expect(roomUnread(state, messages, "jow", { main: 5, "room:m0b1le00": 3 }, 5)("m0b1le00")).toEqual({ n: 1, forMe: true });
    expect(roomUnread(state, messages, "jow", { main: 2 }, 5)("general")).toEqual({ n: 1, forMe: true });
  });
});
