import { describe, expect, test } from "bun:test";

import { howHere, howWords } from "./presence.ts";

describe("howHere", () => {
  test("a daemon seat with a listener or a running session is here", () => {
    expect(howHere({ client: "daemon", reach: "listening", wakes: false })).toBe("listening");
    expect(howHere({ client: "daemon", reach: "running", wakes: false })).toBe("running");
  });

  test("a seat nobody listens for is here only when the daemon can wake it", () => {
    expect(howHere({ client: "daemon", reach: "unreachable", wakes: false })).toBeNull();
    expect(howHere({ client: "daemon", reach: "unreachable", wakes: true })).toBe("wakes");
  });

  test("an older daemon that says nothing about reach is here, how unknown; any other client listens", () => {
    expect(howHere({ client: "daemon", wakes: false })).toBe("unknown");
    expect(howHere({ client: "mcp", wakes: false })).toBe("listening");
    expect(howHere(undefined)).toBeNull();
  });
});

describe("howWords", () => {
  test("an unknown activity reads as nothing, never as Idle", () => {
    expect(howWords("unknown")).toBeNull();
    expect(howWords("listening")).toBe("Listening");
  });
});
