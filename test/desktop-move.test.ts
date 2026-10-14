// The desktop app's moveOver (desktop/src/move.ts): an AppImage update moves the download from the
// temp dir over the running AppImage, and a temp dir on another filesystem makes rename fail with EXDEV.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { moveOver } from "../desktop/src/move.ts";

const exdev = () => Object.assign(new Error("EXDEV: cross-device link not permitted, rename"), { code: "EXDEV" });

function place(): { dir: string; from: string; to: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-move-"));
  const from = path.join(dir, "Kiwi-next.AppImage");
  const to = path.join(dir, "Kiwi.AppImage");
  fs.writeFileSync(from, "new");
  fs.chmodSync(from, 0o755);
  fs.writeFileSync(to, "old");
  return { dir, from, to };
}

describe("moveOver", () => {
  const spies: { mockRestore(): void }[] = [];
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
  });

  test("renames within one filesystem", () => {
    const { dir, from, to } = place();
    moveOver(from, to);
    expect(fs.readFileSync(to, "utf8")).toBe("new");
    expect(fs.existsSync(from)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("across filesystems, copies beside the target and renames it over, keeping the mode", () => {
    const { dir, from, to } = place();
    const rename = fs.renameSync;
    let first = true;
    spies.push(
      spyOn(fs, "renameSync").mockImplementation((a, b) => {
        if (first) {
          first = false;
          throw exdev();
        }
        rename(a, b);
      }),
    );
    moveOver(from, to);
    expect(fs.readFileSync(to, "utf8")).toBe("new");
    expect(fs.statSync(to).mode & 0o777).toBe(0o755);
    expect(fs.existsSync(from)).toBe(false);
    expect(fs.readdirSync(dir)).toEqual(["Kiwi.AppImage"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a copy that fails leaves the target as it was and nothing beside it", () => {
    const { dir, from, to } = place();
    spies.push(spyOn(fs, "renameSync").mockImplementation(() => {
      throw exdev();
    }));
    expect(() => moveOver(from, to)).toThrow("EXDEV");
    expect(fs.readFileSync(to, "utf8")).toBe("old");
    expect(fs.readFileSync(from, "utf8")).toBe("new");
    expect(fs.readdirSync(dir).sort()).toEqual(["Kiwi-next.AppImage", "Kiwi.AppImage"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("any other rename failure is the caller's", () => {
    const { dir, from } = place();
    expect(() => moveOver(from, path.join(dir, "missing", "Kiwi.AppImage"))).toThrow();
    expect(fs.readFileSync(from, "utf8")).toBe("new");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
