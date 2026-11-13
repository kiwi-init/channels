import { describe, expect, test } from "bun:test";
import { makeHolds, type Holdable } from "./held.ts";
import type { StoredMember } from "./store.ts";

const seat = (code: string): StoredMember => ({ code, identity: { name: "me", pk: "pk-me" }, access: { roomId: `room-${code}`, ownerPk: "pk-owner" } as StoredMember["access"], at: 0 });

class Fake implements Holdable {
  opens = 0;
  closes = 0;
  as: "full" | "light" | null = null;
  constructor(readonly light: boolean) {}
  open(): () => void {
    this.opens++;
    return () => void this.closes++;
  }
  serve(as: "full" | "light"): void {
    this.as = as;
  }
}

function setup() {
  const made: Fake[] = [];
  const due: (() => void)[] = [];
  const holds = makeHolds(
    (_m, _h, light) => {
      const f = new Fake(light);
      made.push(f);
      return f;
    },
    (run) => void due.push(run),
  );
  const tick = () => {
    for (const run of due.splice(0)) run();
  };
  return { holds, made, tick };
}

describe("one live store per channel", () => {
  test("Switching away and back reuses the open channel's store: no second connection", () => {
    const { holds, made, tick } = setup();
    const a = seat("a");
    const open = holds.hold(a, undefined, false);
    const leaveOpen = open.use(false);
    const back = holds.hold(a, undefined, true);
    leaveOpen();
    const stayBack = back.use(true);
    tick();
    expect(back.store).toBe(open.store);
    const again = holds.hold(a, undefined, false);
    stayBack();
    const leaveAgain = again.use(false);
    tick();
    expect(again.store).toBe(open.store);
    expect(made).toHaveLength(1);
    expect(made[0]!.opens).toBe(1);
    expect(made[0]!.closes).toBe(0);
    leaveAgain();
  });

  test("A channel never opened stays on its light store, and opening it closes that one", () => {
    const { holds, made, tick } = setup();
    const b = seat("b");
    const light = holds.hold(b, undefined, true);
    const stopLight = light.use(true);
    expect((light.store as Fake).light).toBe(true);
    const full = holds.hold(b, undefined, false);
    expect(full.store).not.toBe(light.store);
    stopLight();
    const stopFull = full.use(false);
    tick();
    expect(made.map((f) => [f.light, f.opens, f.closes])).toEqual([
      [true, 1, 1],
      [false, 1, 0],
    ]);
    expect(holds.live("b")).toEqual([full.store]);
    stopFull();
  });

  test("The background row of an opened channel files its warm copy as light, and as full again when opened", () => {
    const { holds, tick } = setup();
    const c = seat("c");
    const open = holds.hold(c, undefined, false);
    const stop = open.use(false);
    expect((open.store as Fake).as).toBe("full");
    const back = holds.hold(c, undefined, true);
    stop();
    const stopBack = back.use(true);
    tick();
    expect((open.store as Fake).as).toBe("light");
    const stopOpen = holds.hold(c, undefined, false).use(false);
    expect((open.store as Fake).as).toBe("full");
    stopBack();
    stopOpen();
  });

  test("A store nobody uses any more closes, and the next use starts a new one", () => {
    const { holds, made, tick } = setup();
    const d = seat("d");
    const stop = holds.hold(d, undefined, false).use(false);
    stop();
    tick();
    expect(made[0]!.closes).toBe(1);
    expect(holds.live("d")).toEqual([]);
    holds.hold(d, undefined, true).use(true)();
    expect(made).toHaveLength(2);
  });

  test("A seat whose keys changed gets its own store", () => {
    const { holds, made } = setup();
    const e = seat("e");
    holds.hold(e, undefined, false).use(false);
    holds.hold({ ...e, identity: { name: "me", pk: "pk-new" } }, undefined, false).use(false);
    expect(made).toHaveLength(2);
  });
});
