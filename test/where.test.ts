import { describe, expect, test } from "bun:test";
import { parseWhere } from "../src/cli/where.ts";

describe("--to WHERE", () => {
  test("one word says the place: #general, a room, a task, a direct thread, a reply", () => {
    expect(parseWhere("#general")).toEqual({ main: true });
    expect(parseWhere("#design")).toEqual({ room: "design" });
    expect(parseWhere("T7")).toEqual({ task: 7 });
    expect(parseWhere("t12")).toEqual({ task: 12 });
    expect(parseWhere("@ann")).toEqual({ dm: "ann" });
    expect(parseWhere("#123")).toEqual({ re: [123] });
  });

  test("names, roles and everyone are recipients, beside a place or alone", () => {
    expect(parseWhere("ann,bob")).toEqual({ to: ["ann", "bob"] });
    expect(parseWhere("T7, role:reviewer")).toEqual({ task: 7, to: ["role:reviewer"] });
    expect(parseWhere("all")).toEqual({ to: ["all"] });
    expect(parseWhere(undefined)).toEqual({});
  });

  test("two places, or a direct thread with others, is refused with what to do", () => {
    expect(parseWhere("T7,#general")).toBe("--to names one place (T7 and #general are two): #general, #room, T7, @name or #123");
    expect(parseWhere("@ann,bob")).toBe("@ann is a direct thread with them alone; leave out bob");
  });
});
