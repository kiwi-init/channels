import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ELECTROBUN_LAUNCHER } from "../desktop/scripts/linux-files.ts";

const linux = process.platform === "linux";

setDefaultTimeout(30_000);
const root = mkdtempSync(join(tmpdir(), "kiwi-linux-launcher-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const STAND_INS = {
  env: "#include <stdio.h>\nextern char **environ;\nint main(void) {\n  for (char **e = environ; *e; e++) puts(*e);\n  return 0;\n}\n",
  args: '#include <stdio.h>\nint main(int argc, char **argv) {\n  for (int i = 1; i < argc; i++) printf("%s%s", i > 1 ? " " : "", argv[i]);\n  return 0;\n}\n',
};

function launcherBeside(name: keyof typeof STAND_INS): string {
  const bin = join(root, name);
  mkdirSync(bin, { recursive: true });
  execFileSync("cc", ["-O2", "-Wall", "-Wextra", "-Werror", "-o", join(bin, "launcher"), join(import.meta.dir, "../desktop/native/linux/kiwi-launcher.c")]);
  writeFileSync(join(bin, "stand-in.c"), STAND_INS[name]);
  execFileSync("cc", ["-O2", "-o", join(bin, ELECTROBUN_LAUNCHER), join(bin, "stand-in.c")]);
  return join(bin, "launcher");
}

const POLLUTED = {
  HOME: "/home/ana",
  PATH: "/usr/bin:/bin",
  DISPLAY: ":0",
  WAYLAND_DISPLAY: "wayland-0",
  XDG_RUNTIME_DIR: "/run/user/1000",
  DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
  LC_ALL: "pt_BR.UTF-8",
  GTK_IM_MODULE: "fcitx",
  WEBKIT_DISABLE_DMABUF_RENDERER: "1",
  APPIMAGE: "/home/ana/Channels.AppImage",
  https_proxy: "http://proxy:3128",
  LD_PRELOAD: "/tmp/evil.so",
  LD_LIBRARY_PATH: ".",
  BUN_OPTIONS: "--preload=/tmp/evil.ts",
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: "/tmp/cache",
  NODE_OPTIONS: "--require=/tmp/evil.js",
  JSC_useJIT: "false",
  GTK_MODULES: "evil",
  GTK_PATH: "/tmp/gtk",
  GIO_MODULE_DIR: "/tmp/gio",
  GST_PLUGIN_PATH: "/tmp/gst",
  QT_PLUGIN_PATH: "/tmp/qt",
  WEBKIT_INJECTED_BUNDLE_PATH: "/tmp/bundle",
  KIWI_KEY_FD: "3",
  SOMETHING_ELSE: "x",
};

test.skipIf(!linux)("the Linux launcher hands Electrobun's launcher only the names it keeps, and sets the transpiler-cache switch itself, whatever it was given (T1548)", () => {
  const launcher = launcherBeside("env");
  const seen = execFileSync(launcher, [], { env: POLLUTED, encoding: "utf8" }).trim().split("\n");
  expect(seen).toEqual([
    "HOME=/home/ana",
    "PATH=/usr/bin:/bin",
    "DISPLAY=:0",
    "WAYLAND_DISPLAY=wayland-0",
    "XDG_RUNTIME_DIR=/run/user/1000",
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus",
    "LC_ALL=pt_BR.UTF-8",
    "GTK_IM_MODULE=fcitx",
    "WEBKIT_DISABLE_DMABUF_RENDERER=1",
    "APPIMAGE=/home/ana/Channels.AppImage",
    "https_proxy=http://proxy:3128",
    "BUN_RUNTIME_TRANSPILER_CACHE_PATH=0",
  ]);
});

test.skipIf(!linux)("started through a link elsewhere (/usr/bin/channels-desktop), it still starts the Electrobun launcher beside itself, with the arguments it was given (T1548)", () => {
  const launcher = launcherBeside("args");
  const links = join(root, "usr-bin");
  mkdirSync(links, { recursive: true });
  symlinkSync(launcher, join(links, "channels-desktop"));
  const ran = spawnSync(join(links, "channels-desktop"), ["kiwi://join/abc", "--second"], { env: { PATH: "/usr/bin:/bin" }, encoding: "utf8" });
  expect({ status: ran.status, out: ran.stdout.trim() }).toEqual({ status: 0, out: "kiwi://join/abc --second" });
});

test.skipIf(!linux)("with no Electrobun launcher beside it, it says so and starts nothing (T1548)", () => {
  const bin = join(root, "alone");
  mkdirSync(bin, { recursive: true });
  execFileSync("cc", ["-O2", "-o", join(bin, "launcher"), join(import.meta.dir, "../desktop/native/linux/kiwi-launcher.c")]);
  const ran = spawnSync(join(bin, "launcher"), [], { env: {}, encoding: "utf8" });
  expect(ran.status).toBe(127);
  expect(ran.stderr).toContain("can't start the app");
});

function wrapped(name: string, osRelease: string, needs: { gone?: string; beside?: string }): string {
  const bin = join(root, name);
  const parts = join(root, `${name}-parts`);
  mkdirSync(bin, { recursive: true });
  mkdirSync(parts, { recursive: true });
  writeFileSync(join(parts, "os-release"), osRelease);
  execFileSync("cc", [
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    `-DKIWI_OS_RELEASE="${join(parts, "os-release")}"`,
    "-o",
    join(bin, "launcher"),
    join(import.meta.dir, "../desktop/native/linux/kiwi-launcher.c"),
  ]);
  writeFileSync(join(parts, "stand-in.c"), STAND_INS.args);
  execFileSync("cc", ["-O2", "-o", join(bin, ELECTROBUN_LAUNCHER), join(parts, "stand-in.c")]);
  writeFileSync(join(parts, "lib.c"), "int kiwi_part(void) { return 1; }\n");
  const linked: string[] = [];
  for (const [soname, dir] of [
    [needs.gone, parts],
    [needs.beside, bin],
  ] as const) {
    if (!soname) continue;
    execFileSync("cc", ["-shared", "-fPIC", `-Wl,-soname,${soname}`, "-o", join(dir, soname), join(parts, "lib.c")]);
    linked.push(join(dir, soname));
  }
  execFileSync("cc", ["-shared", "-fPIC", "-o", join(bin, "libNativeWrapper.so"), join(parts, "lib.c"), "-Wl,--no-as-needed", ...linked]);
  if (needs.gone) rmSync(join(parts, needs.gone));
  return join(bin, "launcher");
}

const FEDORA = 'NAME="Fedora Linux"\nID=fedora\nVERSION_ID=44\n';

test.skipIf(!linux)("a library the native wrapper needs and this computer lacks is named, with the install line for its distro, and nothing starts (T1066)", () => {
  const ran = spawnSync(wrapped("gone", FEDORA, { gone: "libkiwi-gone.so.1" }), ["kiwi://join/abc"], { env: { PATH: "/usr/bin:/bin" }, encoding: "utf8" });
  expect({ status: ran.status, out: ran.stdout }).toEqual({ status: 127, out: "" });
  expect(ran.stderr).toContain("Channels can't start: this computer is missing libraries it needs:\n  - libkiwi-gone.so.1\n");
  expect(ran.stderr).toContain("(Fedora/RHEL):\n  sudo dnf install gtk3 webkit2gtk4.1 libayatana-appindicator-gtk3 librsvg2\n");
  expect(ran.stderr).not.toMatch(/(?<!ayatana-)libappindicator-gtk3/);
});

test.skipIf(!linux)("the install line follows ID_LIKE, and an unknown distro gets every family's (T1066)", () => {
  const pop = spawnSync(wrapped("pop", 'ID=pop\nID_LIKE="ubuntu debian"\n', { gone: "libkiwi-gone.so.1" }), [], { env: {}, encoding: "utf8" });
  expect(pop.stderr).toContain("(Ubuntu/Debian):\n  sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2\n");
  const other = spawnSync(wrapped("gentoo", "ID=gentoo\n", { gone: "libkiwi-gone.so.1" }), [], { env: {}, encoding: "utf8" });
  for (const line of [
    "sudo apt install",
    "sudo dnf install gtk3 webkit2gtk4.1 libayatana-appindicator-gtk3 librsvg2",
    "sudo pacman -S gtk3 webkit2gtk-4.1 libayatana-appindicator librsvg",
    "sudo zypper install",
  ])
    expect(other.stderr).toContain(line);
});

test.skipIf(!linux)("a wrapper whose libraries are all there, one of them beside it, starts Electrobun's launcher as before (T1066)", () => {
  const ran = spawnSync(wrapped("whole", FEDORA, { beside: "libkiwi-beside.so.1" }), ["--second"], { env: { PATH: "/usr/bin:/bin" }, encoding: "utf8" });
  expect({ status: ran.status, out: ran.stdout.trim(), err: ran.stderr }).toEqual({ status: 0, out: "--second", err: "" });
});
