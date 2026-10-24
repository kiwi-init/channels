import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  APP_RUN,
  APPARMOR,
  APPARMOR_ATTACH,
  APPARMOR_PROFILE,
  APPARMOR_SOURCE,
  appImageName,
  archOfArtifact,
  DEB_POSTINST,
  DEB_POSTRM,
  DEB_PREINST,
  debControl,
  debName,
  desktopEntry,
  LEFT_OUT,
  md5sums,
  runtimeUrl,
} from "../desktop/scripts/linux-files.ts";

describe("the Linux packages made from Electrobun's bundle (T444)", () => {
  test("keep today's asset names, which the site's downloads and the updater look for", () => {
    expect(debName("0.26.0", "x64")).toBe("Channels-0.26.0-linux-amd64.deb");
    expect(appImageName("0.26.0", "x64")).toBe("Channels-0.26.0-linux-x86_64.AppImage");
    expect(appImageName("0.26.0", "arm64")).toBe("Channels-0.26.0-linux-aarch64.AppImage");
    const site = readFileSync(new URL("../site/app.js", import.meta.url), "utf8");
    const version = /Channels-(\d+\.\d+\.\d+)-linux/.exec(site)?.[1] ?? "";
    expect(site).toContain(debName(version, "x64"));
    expect(site).toContain(appImageName(version, "x64"));
  });

  test("come from Electrobun's plain stable artifact, never its self-extracting setup", () => {
    expect(archOfArtifact("stable-linux-x64-Channels.tar.zst")).toBe("x64");
    expect(archOfArtifact("stable-linux-arm64-Channels.tar.zst")).toBe("arm64");
    expect(archOfArtifact("linux-x64-Channels-Setup.tar.gz")).toBeNull();
    expect(archOfArtifact("canary-linux-x64-Channels.tar.zst")).toBeNull();
  });

  test("the .desktop entry opens kiwi:// links and names the icon the packages install", () => {
    const entry = desktopEntry("channels-desktop");
    expect(entry).toContain("Exec=channels-desktop %U\n");
    expect(entry).toContain("MimeType=x-scheme-handler/kiwi;\n");
    expect(entry).toContain("Icon=channels-desktop\n");
    expect(entry).not.toContain("X-AppImage-Version");
    expect(desktopEntry("channels-desktop", "0.26.0")).toContain("X-AppImage-Version=0.26.0\n");
  });

  test("the deb replaces the Electron one (same package) and depends on WebKitGTK, GTK, the tray, SVG icons and WebKitGTK's sandbox (bubblewrap, xdg-dbus-proxy)", () => {
    const control = debControl({ version: "0.26.0", arch: "x64", maintainer: "Jow <jow@example.com>", installedKiB: 113_000.4 });
    expect(control).toContain("Package: kiwi-desktop\n");
    expect(control).toContain("Architecture: amd64\n");
    expect(control).toContain("Installed-Size: 113001\n");
    expect(control).toContain("Depends: libwebkit2gtk-4.1-0, libgtk-3-0, libayatana-appindicator3-1, librsvg2-2, bubblewrap, xdg-dbus-proxy\n");
    expect(control.endsWith("\n")).toBe(true);
  });

  test("leave out Electrobun's updater tools, its uninstall tool and its own .desktop entry: these packages install, update and integrate as a whole", () => {
    expect([...LEFT_OUT]).toEqual(["bin/bspatch", "bin/zig-zstd", "Resources/uninstall", "Channels.desktop"]);
  });

  test("upgrading today's Electron deb keeps /usr/bin/channels-desktop: its postrm removes the channels-desktop alternative after the new files are unpacked (round 1)", () => {
    expect(desktopEntry("/opt/Channels/bin/launcher")).toContain("Exec=/opt/Channels/bin/launcher %U\n");
    expect(DEB_PREINST).toContain("  install|upgrade) if command -v update-alternatives >/dev/null 2>&1; then update-alternatives --remove-all channels-desktop >/dev/null 2>&1 || true; fi ;;");
    expect(DEB_POSTINST).toContain("[ -e /usr/bin/channels-desktop ] || ln -sf /opt/Channels/bin/launcher /usr/bin/channels-desktop\n");
    expect(DEB_POSTRM).not.toContain("/usr/bin/channels-desktop");
    expect(DEB_POSTRM).not.toContain("update-alternatives");
    for (const script of [DEB_PREINST, DEB_POSTINST, DEB_POSTRM]) {
      expect(script.startsWith("#!/bin/sh\nset -e\n")).toBe(true);
      expect(spawnSync("sh", ["-n"], { input: script }).status).toBe(0);
    }
  });

  test("on Ubuntu 24.04 the deb's AppArmor profile lets Bun, which spawns WebKitGTK's bubblewrap, use user namespaces, and changes nothing else (T2202)", () => {
    expect(APPARMOR_ATTACH).toBe("/opt/Channels/bin/bun");
    expect(APPARMOR_SOURCE).toBe("/usr/share/kiwi-desktop/apparmor/channels-desktop");
    expect(APPARMOR_PROFILE).toBe("/etc/apparmor.d/channels-desktop");
    expect(APPARMOR).toBe(
      "abi <abi/4.0>,\ninclude <tunables/global>\n\nprofile channels-desktop /opt/Channels/bin/bun flags=(unconfined) {\n  userns,\n\n  include if exists <local/channels-desktop>\n}\n",
    );
    expect(DEB_POSTINST).toContain(`apparmor_parser --skip-kernel-load --skip-cache --quiet ${APPARMOR_SOURCE} >/dev/null 2>&1; then\n  cp -f ${APPARMOR_SOURCE} ${APPARMOR_PROFILE}\n`);
    expect(DEB_POSTINST).toContain(`apparmor_parser --replace --write-cache --skip-read-cache ${APPARMOR_PROFILE} || true; fi\n`);
    expect(DEB_POSTRM).toContain(`  remove|purge)\n    if [ -e ${APPARMOR_PROFILE} ]`);
    expect(DEB_POSTRM).toContain(`apparmor_parser --remove ${APPARMOR_PROFILE} >/dev/null 2>&1 || true; fi\n    rm -f ${APPARMOR_PROFILE} /var/cache/apparmor/*/channels-desktop\n`);
  });

  test("the deb lists each file's md5, as dpkg --verify reads it", () => {
    expect(md5sums([{ path: "opt/Channels/bin/launcher", md5: "d41d8cd98f00b204e9800998ecf8427e" }])).toBe("d41d8cd98f00b204e9800998ecf8427e  opt/Channels/bin/launcher\n");
  });

  test("the AppImage starts Electrobun's launcher from wherever it's mounted, with a pinned runtime", () => {
    expect(APP_RUN).toContain('exec "$HERE/Channels/bin/launcher" "$@"');
    expect(runtimeUrl("x64")).toBe("https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64");
  });
});
