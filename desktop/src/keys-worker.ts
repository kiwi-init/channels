import { parentPort } from "node:worker_threads";

import { installKeysShim, type ToWorker } from "./keys-shim.ts";

const port = parentPort;
if (!port) throw new Error("the keys worker runs only inside a Worker");

installKeysShim({ post: (m) => port.postMessage(m), listen: (fn) => port.on("message", (m: ToWorker) => fn(m)) });

await import("./channels.ts");
