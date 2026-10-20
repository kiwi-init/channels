import { describe, expect, test } from "bun:test";
import { launchedView, launchRequestOf } from "../desktop/src/launch-view.ts";

const good = {
  launch: "AbCdEfGhIjKlMnOpQrStUv",
  harness: "claude" as const,
  folder: "/Users/someone/app",
  code: "mc2-81x_V6V9-0ERFFKx",
  relay: "https://relay.kiwi.example",
  nick: "claude two",
  persona: "eyJyb29tIjoi",
};

describe("the launch the renderer asks for", () => {
  test("a well-formed one passes as is, without the fields it left out", () => {
    expect(launchRequestOf(good)).toEqual(good);
    const bare = { launch: good.launch, harness: good.harness, folder: good.folder, code: good.code, relay: good.relay };
    expect(launchRequestOf(bare)).toEqual(bare);
  });

  test("a bad id, harness, folder, code, relay, nickname or persona is refused whole", () => {
    for (const over of [
      { launch: "short" },
      { harness: "vim" },
      { folder: "relative/app" },
      { code: "mc2 x; rm -rf ~" },
      { relay: "https://relay.example/path" },
      { relay: "file:///etc" },
      { nick: "-dash first" },
      { nick: "a".repeat(41) },
      { nick: "quote's" },
      { persona: "has space" },
    ]) {
      expect(launchRequestOf({ ...good, ...over })).toBeNull();
    }
    expect(launchRequestOf(null)).toBeNull();
  });
});

describe("the daemon's answer", () => {
  test("each place keeps only what the app shows", () => {
    const rex = { server: "unix:///s.sock", session: "session:1", block: "block:2" };
    expect(launchedView({ ok: true, launch: good.launch, placed: { ok: true, place: "rex", rex, window: "window:3", pid: 9 } })).toEqual({ ok: true, launch: good.launch, place: "rex", rex });
    expect(launchedView({ ok: true, launch: good.launch, placed: { ok: true, place: "tmux", socket: "/tmp/s", session: "kiwi", window: "@4", pane: "%4" } })).toEqual({
      ok: true,
      launch: good.launch,
      place: "tmux",
      session: "kiwi",
      window: "@4",
    });
    expect(launchedView({ ok: true, launch: good.launch, placed: { ok: true, place: "terminal", window: 12 } })).toEqual({ ok: true, launch: good.launch, place: "terminal" });
  });

  test("a refusal keeps its reason, and anything unknown is a failure", () => {
    expect(launchedView({ ok: false, why: "no-recipe", detail: "Kiwi can't start gemini yet" })).toEqual({ ok: false, why: "no-recipe", detail: "Kiwi can't start gemini yet" });
    expect(launchedView({ ok: false, why: "exploded" })).toEqual({ ok: false, why: "failed", detail: "" });
    expect(launchedView({ ok: true, launch: good.launch, placed: { ok: true, place: "screen" } })).toMatchObject({ ok: false, why: "failed" });
    expect(launchedView(undefined)).toMatchObject({ ok: false, why: "failed" });
  });
});
