import { describe, expect, test } from "bun:test";

import { openerFor } from "../desktop/src/mod-editor.ts";

describe("a new mod opens in the person's editor (T7401)", () => {
  const none = () => null;
  test("on a Mac: the first editor app found, in /Applications or ~/Applications, else Finder", () => {
    const apps = (have: string[]) => (at: string) => have.includes(at);
    expect(openerFor("/m/notes", { platform: "darwin", home: "/Users/a", app: apps(["/Applications/Zed.app", "/Users/a/Applications/Cursor.app"]), bin: none })).toEqual({
      argv: ["/usr/bin/open", "-a", "/Users/a/Applications/Cursor.app", "/m/notes"],
      editor: "Cursor",
    });
    expect(openerFor("/m/notes", { platform: "darwin", home: "/Users/a", app: apps(["/Applications/Zed.app"]), bin: none }).editor).toBe("Zed");
    expect(openerFor("/m/notes", { platform: "darwin", home: "/Users/a", app: apps([]), bin: none })).toEqual({ argv: ["/usr/bin/open", "/m/notes"], editor: null });
  });

  test("on Linux: the first editor on PATH, else xdg-open, else nothing", () => {
    const bins = (have: Record<string, string>) => (n: string) => have[n] ?? null;
    expect(openerFor("/m/notes", { platform: "linux", home: "/home/a", app: () => true, bin: bins({ code: "/usr/bin/code", subl: "/usr/bin/subl" }) })).toEqual({
      argv: ["/usr/bin/code", "/m/notes"],
      editor: "Visual Studio Code",
    });
    expect(openerFor("/m/notes", { platform: "linux", home: "/home/a", app: () => true, bin: bins({ zeditor: "/usr/bin/zeditor" }) }).editor).toBe("Zed");
    expect(openerFor("/m/notes", { platform: "linux", home: "/home/a", app: () => true, bin: bins({ "xdg-open": "/usr/bin/xdg-open" }) })).toEqual({ argv: ["/usr/bin/xdg-open", "/m/notes"], editor: null });
    expect(openerFor("/m/notes", { platform: "linux", home: "/home/a", app: () => true, bin: none })).toEqual({ argv: [], editor: null });
  });
});
