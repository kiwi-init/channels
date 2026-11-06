import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { KeyBindingsView } from "../desktop/src/bridge.ts";
import { keysCalls } from "../desktop/src/ipc/keys.ts";
import { readKeys, watchKeys } from "../desktop/src/keys-file.ts";
import { fakeHost } from "./fake-host.ts";

const homes: string[] = [];
const home = (): string => {
  const at = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-keys-"));
  homes.push(at);
  return at;
};
afterEach(() => {
  for (const at of homes.splice(0)) fs.rmSync(at, { recursive: true, force: true });
});

const until = async (ok: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(20);
  }
};

describe("~/.kiwi/keys.json", () => {
  test("no file is no file, not a problem", () => {
    const at = home();
    expect(readKeys(at)).toEqual({ file: path.join(at, "keys.json"), present: false, keys: null });
  });

  test("the file's JSON goes to the page as it is: the page checks each entry", () => {
    const at = home();
    fs.writeFileSync(path.join(at, "keys.json"), JSON.stringify({ "app.palette": "mod+p", "app.calm": null }));
    expect(readKeys(at)).toEqual({ file: path.join(at, "keys.json"), present: true, keys: { "app.palette": "mod+p", "app.calm": null } });
  });

  test("a file that isn't JSON or is too big says why and binds nothing", () => {
    const at = home();
    fs.writeFileSync(path.join(at, "keys.json"), "{ app.palette: mod+p");
    expect(readKeys(at)).toMatchObject({ present: true, keys: null, error: "isn't valid JSON" });
    fs.writeFileSync(path.join(at, "keys.json"), JSON.stringify({ pad: "x".repeat(70_000) }));
    expect(readKeys(at)).toMatchObject({ present: true, keys: null, error: "is over 64 KB" });
  });

  test("watching the folder calls back for keys.json and not for the folder's other files", async () => {
    const at = home();
    let calls = 0;
    const stop = watchKeys(
      at,
      () => calls++,
      () => {},
    );
    await Bun.sleep(200);
    fs.writeFileSync(path.join(at, "daemon.json"), "{}");
    await Bun.sleep(400);
    expect(calls).toBe(0);
    fs.writeFileSync(path.join(at, "keys.json"), "{}");
    await until(() => calls > 0);
    stop();
  });

  test("the first call starts the watch, and an edit is pushed to the page", async () => {
    const at = home();
    const shell = fakeHost();
    const pushed: KeyBindingsView[] = [];
    const host = { ...shell.host, push: (name: string, value: unknown) => void (name === "keyBindings" && pushed.push(value as KeyBindingsView)) };
    const calls = keysCalls(host as typeof shell.host, () => at);
    expect((await calls.keyBindings()).present).toBe(false);
    await Bun.sleep(200);
    fs.writeFileSync(path.join(at, "keys.json"), JSON.stringify({ "view.sidebar": "mod+b" }));
    await until(() => pushed.some((v) => v.present));
    expect(pushed.at(-1)?.keys).toEqual({ "view.sidebar": "mod+b" });
  });
});
