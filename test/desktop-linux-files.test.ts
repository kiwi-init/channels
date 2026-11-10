import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { APP_RUN, appImageName, archOfArtifact, BREEZE_DARK_APPS, desktopEntry, LEFT_OUT, pngInSvg, runtimeUrl } from "../desktop/scripts/linux-files.ts";

describe("the Linux AppImage made from Electrobun's bundle (T444)", () => {
  test("keeps today's asset name, which the site's downloads and the updater look for, and no .deb is offered", () => {
    expect(appImageName("0.26.0", "x64")).toBe("Channels-0.26.0-linux-x86_64.AppImage");
    expect(appImageName("0.26.0", "arm64")).toBe("Channels-0.26.0-linux-aarch64.AppImage");
    const site = readFileSync(new URL("../site/app.js", import.meta.url), "utf8");
    const version = /Channels-(\d+\.\d+\.\d+)-linux/.exec(site)?.[1] ?? "";
    expect(site).toContain(appImageName(version, "x64"));
    expect(site).not.toContain(".deb");
  });

  test("comes from Electrobun's plain stable artifact, never its self-extracting setup", () => {
    expect(archOfArtifact("stable-linux-x64-Channels.tar.zst")).toBe("x64");
    expect(archOfArtifact("stable-linux-arm64-Channels.tar.zst")).toBe("arm64");
    expect(archOfArtifact("linux-x64-Channels-Setup.tar.gz")).toBeNull();
    expect(archOfArtifact("canary-linux-x64-Channels.tar.zst")).toBeNull();
  });

  test("the .desktop entry opens kiwi:// links and names the icon the AppImage carries", () => {
    const entry = desktopEntry("channels-desktop");
    expect(entry).toContain("Name=Channels\n");
    expect(entry).toContain("Exec=channels-desktop %U\n");
    expect(entry).toContain("StartupWMClass=Channels\n");
    expect(entry).toContain("StartupNotify=true\n");
    expect(entry).toContain("MimeType=x-scheme-handler/kiwi;\n");
    expect(entry).toContain("Icon=channels-desktop\n");
    expect(entry).not.toContain("X-AppImage-Version");
    expect(desktopEntry("channels-desktop", "0.26.0")).toContain("X-AppImage-Version=0.26.0\n");
  });

  test("leaves out Electrobun's updater tools, its uninstall tool and its own .desktop entry: the AppImage updates and integrates as a whole", () => {
    expect([...LEFT_OUT]).toEqual(["bin/bspatch", "bin/zig-zstd", "Resources/uninstall", "Channels.desktop"]);
  });

  test("the dark icons are SVGs that carry the PNG, in breeze-dark's own app folders: Breeze themes look up .svg only (#2015)", () => {
    expect(BREEZE_DARK_APPS.map((a) => a.dir)).toEqual(["16", "22", "32", "48"]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const svg = pngInSvg(png, 22);
    expect(svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="22" height="22" viewBox="0 0 22 22"');
    expect(svg).toContain(`xlink:href="data:image/png;base64,${Buffer.from(png).toString("base64")}"`);
  });

  test("the AppImage starts Electrobun's launcher from wherever it's mounted, with a pinned runtime", () => {
    expect(APP_RUN).toContain('exec "$HERE/Channels/bin/launcher" "$@"');
    expect(runtimeUrl("x64")).toBe("https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64");
  });
});
