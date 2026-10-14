// What a member hears when a frame on its socket fails (T115): a refusal's own text, and for
// anything else only "internal error". Exception text (SQLite, storage) never reaches a member.

import { expect, spyOn, test } from "bun:test";
import * as Cause from "effect/Cause";
import { BadRequest } from "../src/relay/failures.ts";
import { socketError } from "../src/relay/room.ts";

test("a refusal says why", () => {
  expect(socketError(Cause.fail(new BadRequest({ message: "unknown epoch" })))).toBe("unknown epoch");
});

test("a storage error is logged, and the member hears only that it failed", () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(socketError(Cause.die(new Error("SQLITE_FULL: database or disk is full")))).toBe("internal error");
    expect(socketError(Cause.die(new Error("SQLITE_IOERR")))).toBe("internal error");
    expect(log).toHaveBeenCalledTimes(2);
  } finally {
    log.mockRestore();
  }
});
