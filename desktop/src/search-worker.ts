import { parentPort } from "node:worker_threads";

import { SearchCore } from "./search-core.ts";
import type { SearchAsk, SearchReply } from "./search-types.ts";

const port = parentPort;
if (!port) throw new Error("the search worker runs only inside a Worker");

const core = new SearchCore();
let queue: Promise<void> = Promise.resolve();

port.on("message", (ask: SearchAsk) => {
  queue = queue.then(async () => {
    const reply: SearchReply = await core.handle(ask).then(
      (value): SearchReply => ({ id: ask.id, ok: true, value }),
      (e: unknown): SearchReply => ({ id: ask.id, ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    port.postMessage(reply);
  });
});
