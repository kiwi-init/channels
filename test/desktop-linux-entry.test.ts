import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ENTRY_FILE, entryText, execArgs, hasFusermount, keepEntry, keepLinuxEntry, launchedFile, quotedExec, withKiwiDefault } from "../desktop/src/linux-entry.ts";

const root = mkdtempSync(join(tmpdir(), "kiwi-linux-entry-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
function place(fuse = true): { appImage: string; appDir: string; dataHome: string; configHome: string; fuse: boolean } {
  const at = join(root, String(n++));
  const appDir = join(at, "squashfs-root");
  for (const size of ["64x64", "512x512"]) {
    mkdirSync(join(appDir, "usr", "share", "icons", "hicolor", size, "apps"), { recursive: true });
    writeFileSync(join(appDir, "usr", "share", "icons", "hicolor", size, "apps", "channels-desktop.png"), `png ${size}`);
  }
  return { appImage: join(at, "Apps", "Channels.AppImage"), appDir, dataHome: join(at, "data"), configHome: join(at, "config"), fuse };
}

describe("the AppImage keeps its own desktop entry (#1284)", () => {
  test("Exec quotes the AppImage's path the way the Desktop Entry spec reads it back", () => {
    expect(quotedExec("/home/a/Channels.AppImage")).toBe('"/home/a/Channels.AppImage"');
    expect(quotedExec("/home/a b/50%/Channels.AppImage")).toBe('"/home/a b/50%%/Channels.AppImage"');
    expect(quotedExec('/home/a/"$x`\\.AppImage')).toBe('"/home/a/\\\\"\\\\$x\\\\`\\\\\\\\.AppImage"');
    expect(quotedExec("relative/Channels.AppImage")).toBeNull();
    expect(quotedExec("/home/a\nExec=evil")).toBeNull();
  });

  test("with FUSE the entry runs the AppImage; without it, the entry extracts and runs it (#1283)", () => {
    const fused = entryText("/opt/x/Channels.AppImage", true) ?? "";
    expect(fused).toContain('Exec="/opt/x/Channels.AppImage" %U\n');
    expect(fused).toContain("MimeType=x-scheme-handler/kiwi;\n");
    expect(fused).toContain("Icon=channels-desktop\n");
    expect(entryText("/opt/x/Channels.AppImage", false)).toContain('Exec=env APPIMAGE_EXTRACT_AND_RUN=1 "/opt/x/Channels.AppImage" %U\n');
  });

  test("FUSE counts as there when PATH has fusermount3 or fusermount", () => {
    const has = (names: string[]) => (file: string) => names.includes(file);
    expect(hasFusermount("/usr/local/bin:/usr/bin", has(["/usr/bin/fusermount3"]))).toBe(true);
    expect(hasFusermount("/usr/bin", has(["/usr/bin/fusermount"]))).toBe(true);
    expect(hasFusermount("/usr/bin", has([]))).toBe(false);
    expect(hasFusermount("bin:/usr/bin", has(["bin/fusermount3"]))).toBe(false);
    expect(hasFusermount(undefined, has(["/fusermount3"]))).toBe(false);
  });

  test("the kiwi handler becomes the default only where nothing claims it", () => {
    expect(withKiwiDefault(null)).toBe(`[Default Applications]\nx-scheme-handler/kiwi=${ENTRY_FILE}\n`);
    expect(withKiwiDefault("[Added Associations]\ntext/plain=a.desktop")).toBe(`[Added Associations]\ntext/plain=a.desktop\n\n[Default Applications]\nx-scheme-handler/kiwi=${ENTRY_FILE}\n`);
    expect(withKiwiDefault("[Default Applications]\ntext/html=b.desktop\n")).toBe(`[Default Applications]\nx-scheme-handler/kiwi=${ENTRY_FILE}\ntext/html=b.desktop\n`);
    expect(withKiwiDefault("[Default Applications]\nx-scheme-handler/kiwi=other.desktop\n")).toBeNull();
    expect(withKiwiDefault(`[Default Applications]\nx-scheme-handler/kiwi = ${ENTRY_FILE}\n`)).toBeNull();
    expect(withKiwiDefault("[Added Associations]\nx-scheme-handler/kiwi=other.desktop\n")).toContain(`[Default Applications]\nx-scheme-handler/kiwi=${ENTRY_FILE}\n`);
  });

  test("writes the entry, the icons and the kiwi default, then leaves them alone while nothing changed", () => {
    const p = place();
    const first = keepEntry(p);
    const entry = join(p.dataHome, "applications", ENTRY_FILE);
    expect(first.kind === "kept" ? [...first.wrote].sort() : first).toEqual(
      [
        join(p.dataHome, "icons", "hicolor", "512x512", "apps", "channels-desktop.png"),
        join(p.dataHome, "icons", "hicolor", "64x64", "apps", "channels-desktop.png"),
        entry,
        join(p.configHome, "mimeapps.list"),
      ].sort(),
    );
    expect(readFileSync(entry, "utf8")).toContain(`Exec="${p.appImage}" %U\n`);
    expect(readFileSync(join(p.dataHome, "icons", "hicolor", "64x64", "apps", "channels-desktop.png"), "utf8")).toBe("png 64x64");
    const mtime = statSync(entry).mtimeMs;
    expect(keepEntry(p)).toEqual({ kind: "kept", wrote: [] });
    expect(statSync(entry).mtimeMs).toBe(mtime);
  });

  test("a moved AppImage, or one that lost FUSE, rewrites only the entry", () => {
    const p = place();
    keepEntry(p);
    const moved = { ...p, appImage: join(root, "elsewhere", "Channels.AppImage"), fuse: false };
    expect(keepEntry(moved)).toEqual({ kind: "kept", wrote: [join(p.dataHome, "applications", ENTRY_FILE)] });
    expect(readFileSync(join(p.dataHome, "applications", ENTRY_FILE), "utf8")).toContain(`Exec=env APPIMAGE_EXTRACT_AND_RUN=1 "${moved.appImage}" %U\n`);
  });

  test("an entry AppImageLauncher made for this AppImage is left to do the job", () => {
    const p = place();
    mkdirSync(join(p.dataHome, "applications"), { recursive: true });
    writeFileSync(join(p.dataHome, "applications", "appimagekit_0123-Channels.desktop"), `[Desktop Entry]\nExec=${p.appImage} %U\n`);
    expect(keepEntry(p)).toEqual({ kind: "skipped", why: `appimagekit_0123-Channels.desktop already starts this AppImage` });
    expect(existsSync(join(p.dataHome, "applications", ENTRY_FILE))).toBe(false);
    expect(existsSync(join(p.configHome, "mimeapps.list"))).toBe(false);
  });

  test("Exec reads back to the AppImage it starts, through env, quotes and every escape", () => {
    for (const appImage of ["/home/a/Channels.AppImage", "/home/a b/50%/Channels.AppImage", '/home/a/"$x`\\.AppImage']) {
      for (const fuse of [true, false]) {
        const exec = /^Exec=(.*)$/m.exec(entryText(appImage, fuse) ?? "")?.[1] ?? "";
        expect(launchedFile(execArgs(exec) ?? [])).toBe(appImage);
      }
    }
    expect(execArgs("/opt/Channels.AppImage %U")).toEqual(["/opt/Channels.AppImage", "%U"]);
    expect(execArgs('"/opt/unclosed %U')).toBeNull();
    expect(launchedFile(["env", "A=1", "B=2", "/opt/x.AppImage", "%U"])).toBe("/opt/x.AppImage");
    expect(launchedFile(["env"])).toBeNull();
  });

  test("an entry for another AppImage whose path starts the same, or that only passes ours as an argument, doesn't count", () => {
    const p = place();
    mkdirSync(join(p.dataHome, "applications"), { recursive: true });
    writeFileSync(join(p.dataHome, "applications", "old.desktop"), `[Desktop Entry]\nExec="${p.appImage}.old" %U\n`);
    writeFileSync(join(p.dataHome, "applications", "opener.desktop"), `[Desktop Entry]\nExec=/usr/bin/xdg-open "${p.appImage}"\n`);
    expect(keepEntry(p).kind).toBe("kept");
    expect(existsSync(join(p.dataHome, "applications", ENTRY_FILE))).toBe(true);
  });

  test("a mimeapps.list that can't be read is never replaced", () => {
    const p = place();
    mkdirSync(p.configHome, { recursive: true });
    const mimeapps = join(p.configHome, "mimeapps.list");
    writeFileSync(mimeapps, "[Default Applications]\ntext/html=firefox.desktop\n");
    chmodSync(mimeapps, 0o000);
    try {
      expect(() => keepEntry(p)).toThrow();
    } finally {
      chmodSync(mimeapps, 0o644);
    }
    expect(readFileSync(mimeapps, "utf8")).toBe("[Default Applications]\ntext/html=firefox.desktop\n");
  });

  test("a path no desktop entry can hold is skipped, not half-written", () => {
    const p = { ...place(), appImage: "/home/a\nb/Channels.AppImage" };
    expect(keepEntry(p).kind).toBe("skipped");
    expect(existsSync(p.dataHome)).toBe(false);
  });

  test("XDG folders come from the environment when absolute, else from the home folder", () => {
    const p = place();
    const home = join(root, "home");
    const env = { APPDIR: p.appDir, PATH: "", XDG_DATA_HOME: "relative", XDG_CONFIG_HOME: join(root, "xdg-config") };
    expect(keepLinuxEntry(p.appImage, env, home).kind).toBe("kept");
    expect(readFileSync(join(home, ".local", "share", "applications", ENTRY_FILE), "utf8")).toContain("APPIMAGE_EXTRACT_AND_RUN=1");
    expect(readFileSync(join(root, "xdg-config", "mimeapps.list"), "utf8")).toContain(`x-scheme-handler/kiwi=${ENTRY_FILE}`);
    expect(keepLinuxEntry(p.appImage, {}, home)).toEqual({ kind: "skipped", why: "the AppImage runtime set no APPDIR" });
  });
});
