import { describe, expect, test } from "bun:test";

import { sendsInTurn } from "./send-order";

const later = <T>(ms: number, value: T, fail = false): Promise<T> => new Promise((ok, no) => setTimeout(() => (fail ? no(new Error("relay said no")) : ok(value)), ms));

describe("messages go out in the order they were typed", () => {
  test("a quick second send waits for a slow first one", async () => {
    const inTurn = sendsInTurn();
    const order: string[] = [];
    await Promise.all([inTurn(() => later(30, "first").then((v) => void order.push(v))), inTurn(() => later(1, "second").then((v) => void order.push(v)))]);
    expect(order).toEqual(["first", "second"]);
  });

  test("one that fails doesn't hold back the next", async () => {
    const inTurn = sendsInTurn();
    const first = inTurn(() => later(5, 0, true));
    const second = inTurn(() => later(1, 2));
    await expect(first).rejects.toThrow("relay said no");
    expect(await second).toBe(2);
  });
});
