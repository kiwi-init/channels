import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { useHost } from "../desktop/src/host.ts";
import { handlers } from "../desktop/src/ipc/handlers.ts";
import { logFile } from "../desktop/src/main-log.ts";
import { fakeHost } from "./fake-host.ts";

const dir = mkdtempSync(join(tmpdir(), "kiwi-open-log-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test.skipIf(process.platform !== "linux")("a link xdg-open fails to open rejects to the page and leaves its reason in main.log (#2534)", async () => {
  const shell = fakeHost({ paths: { logs: join(dir, "logs") } });
  useHost(shell.host);
  writeFileSync(join(dir, "xdg-open"), "#!/bin/sh\necho \"xdg-open: no method available for opening '$1'\" >&2\nexit 3\n");
  chmodSync(join(dir, "xdg-open"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${dir}:${path ?? ""}`;
  try {
    const open = handlers(shell.host).openExternal;
    await expect(open("https://example.com/x")).rejects.toThrow("xdg-open couldn't open the link: exit 3: xdg-open: no method available for opening 'https://example.com/x'");
  } finally {
    process.env.PATH = path;
  }
  expect(readFileSync(logFile(), "utf8")).toContain(
    "could not open https://example.com/x in the system browser: xdg-open couldn't open the link: exit 3: xdg-open: no method available for opening 'https://example.com/x'",
  );
});
