import { expect, test } from "bun:test";
import { mimeOf } from "../desktop/src/mime.ts";

test("the app serves WebAssembly and module scripts with types a browser runs, and anything else as bytes", () => {
  expect(mimeOf("/app/web/dist/assets/module.wasm")).toBe("application/wasm");
  expect(mimeOf("/app/web/dist/assets/worker.mjs")).toBe("text/javascript");
  expect(mimeOf("/app/web/dist/assets/index.js")).toBe("text/javascript");
  expect(mimeOf("/app/web/dist/data.bin")).toBe("application/octet-stream");
});
