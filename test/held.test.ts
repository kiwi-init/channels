import { expect, test } from "bun:test";
import { held } from "../desktop/src/held.ts";

test("a value is fetched once per key while fresh, again once it's old", async () => {
  let t = 0;
  let calls = 0;
  const get = held(
    1000,
    async (k: string) => `${k}${++calls}`,
    () => t,
  );
  expect(await Promise.all([get("a"), get("a")])).toEqual(["a1", "a1"]);
  expect(await get("b")).toBe("b2");
  t = 999;
  expect(await get("a")).toBe("a1");
  t = 1000;
  expect(await get("a")).toBe("a3");
});

test("a failure isn't kept: the next ask tries again", async () => {
  let calls = 0;
  const get = held(60_000, async () => {
    if (++calls === 1) throw new Error("relay down");
    return "ok";
  });
  await expect(get("x")).rejects.toThrow("relay down");
  expect(await get("x")).toBe("ok");
  expect(calls).toBe(2);
});
