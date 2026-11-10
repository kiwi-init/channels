import { describe, expect, test } from "bun:test";

import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts";
import type { FollowEvent, WireError } from "../../../desktop/src/bridge.ts";
import { refollowing } from "./refollow.ts";

const WAIT = 20;
const msg = (seq: number): Message => ({ v: PROTOCOL_VERSION, id: `id-${seq}`, from: "atlas", kind: "msg", body: `m${seq}`, ts: 1_700_000_000_000 + seq, seq, sigOk: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const failed = (error: WireError): FollowEvent => ({ _tag: "Failed", error });
const broke = failed({ kind: "other", message: "the stream broke" });

function streams(failsAtOnce = 0) {
  const made: { since: number; at: number; on: (e: FollowEvent) => void; stopped: boolean; watch: boolean }[] = [];
  const heard: FollowEvent[] = [];
  const follow = refollowing((_code, since, on, opts) => {
    const s = { since, at: Date.now(), on, stopped: false, watch: opts?.watch === true };
    made.push(s);
    if (made.length <= failsAtOnce) on(broke);
    return () => {
      s.stopped = true;
    };
  }, WAIT);
  return { made, heard, follow, hear: (e: FollowEvent) => void heard.push(e) };
}

describe("following again after a stream dies (T1784)", () => {
  test("a failure that isn't final starts a new stream from the last seq heard, with the same options, and passes the failure on", async () => {
    const s = streams();
    const stop = s.follow("code", 4, s.hear, { watch: true });
    s.made[0]!.on({ _tag: "Message", message: msg(5), row: null });
    s.made[0]!.on({ _tag: "Unread", seq: 6, row: null });
    s.made[0]!.on({ _tag: "Head", seq: 8 });
    s.made[0]!.on(broke);
    expect(s.heard.at(-1)).toEqual(broke);
    await sleep(WAIT * 3);
    expect(s.made).toHaveLength(2);
    expect(s.made[0]!.stopped).toBe(true);
    expect(s.made[1]).toMatchObject({ since: 8, watch: true, stopped: false });
    s.made[0]!.on({ _tag: "Message", message: msg(9), row: null });
    expect(s.heard).toHaveLength(4);
    stop();
    expect(s.made[1]!.stopped).toBe(true);
  });

  test("a stream that fails before it is even returned is followed again too", async () => {
    const s = streams(2);
    const stop = s.follow("code", 0, s.hear);
    await sleep(WAIT * 6);
    expect(s.made).toHaveLength(3);
    expect(s.heard).toEqual([broke, broke]);
    stop();
  });

  test("each failure in a row waits twice as long, and an Open starts the wait over", async () => {
    const s = streams();
    const stop = s.follow("code", 0, s.hear);
    for (let i = 0; i < 3; i++) {
      s.made[i]!.on(broke);
      const from = Date.now();
      while (s.made.length === i + 1 && Date.now() - from < 1_000) await sleep(2);
    }
    const waits = s.made.slice(1).map((m, i) => m.at - s.made[i]!.at);
    expect(waits[1]!).toBeGreaterThanOrEqual(WAIT * 2 - 2);
    expect(waits[2]!).toBeGreaterThanOrEqual(WAIT * 4 - 2);
    s.made[3]!.on({ _tag: "Open" });
    s.made[3]!.on(broke);
    await sleep(WAIT * 2);
    expect(s.made).toHaveLength(5);
    stop();
  });

  test("a channel that is gone, or a sign-in that ended, is not followed again", async () => {
    for (const error of [
      { kind: "gone", why: "removed" },
      { kind: "gone", why: "closed" },
      { kind: "relay", status: 401, message: "sign in", tag: "SignInRequired" },
    ] satisfies WireError[]) {
      const s = streams();
      const stop = s.follow("code", 0, s.hear);
      s.made[0]!.on(failed(error));
      await sleep(WAIT * 3);
      expect(s.made).toHaveLength(1);
      expect(s.heard).toEqual([failed(error)]);
      stop();
    }
  });

  test("stopping while it waits follows nothing more", async () => {
    const s = streams();
    const stop = s.follow("code", 0, s.hear);
    s.made[0]!.on(broke);
    stop();
    await sleep(WAIT * 3);
    expect(s.made).toHaveLength(1);
    expect(s.made[0]!.stopped).toBe(true);
  });
});
