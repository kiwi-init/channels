import { expect, test } from "bun:test";
import type { Channel } from "@kiwi/core/client.ts";
import { blockMedia } from "../src/agent/docs.ts";

const channelWhoseDoc = (refused: string | null): Channel =>
  ({
    stream: (_from: number, _on: unknown, opts: { onReady: () => void; signal: AbortSignal }) => {
      opts.onReady();
      return new Promise<void>((_, fail) => opts.signal.addEventListener("abort", () => fail(new Error("aborted"))));
    },
    threadDoc: async () => ({ whenSynced: () => new Promise<void>(() => {}), refused }),
    closeDoc: async () => {},
  }) as unknown as Channel;

const at = { key: "main", th: "thread-aaaaaaaaaaaaaaa" };

test("a doc the relay refused to open says why, not that reading it was slow (#2575)", async () => {
  await expect(blockMedia(channelWhoseDoc("too many doc subscriptions; wait a minute"), 0, at, "b1", 50)).rejects.toThrow(
    "the relay refused the thread's doc: too many doc subscriptions; wait a minute",
  );
});

test("a doc that never syncs with no refusal still says the read took too long", async () => {
  await expect(blockMedia(channelWhoseDoc(null), 0, at, "b1", 50)).rejects.toThrow("reading the thread's doc took over 0 s");
});
