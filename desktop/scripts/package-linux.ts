import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  APP_RUN,
  APPARMOR,
  APPARMOR_SOURCE,
  appImageName,
  archOfArtifact,
  DEB_POSTINST,
  DEB_POSTRM,
  DEB_PREINST,
  debControl,
  ELECTROBUN_LAUNCHER,
  debName,
  desktopEntry,
  EXECUTABLE,
  INSTALL_DIR,
  LEFT_OUT,
  MAX_DOWNLOAD,
  md5sums,
  RUNTIME_SHA256,
  runtimeUrl,
  type LinuxArch,
} from "./linux-files.ts";

const desktop = resolve(import.meta.dirname, "..");
const dir = resolve(process.argv[2] ?? join(desktop, "release-eb"));
const out = resolve(process.argv[3] ?? join(dir, "linux"));
const MB = 1024 ** 2;

function sizeOf(path: string): number {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0);
}

function filesUnder(root: string, at: string): string[] {
  return readdirSync(join(root, at), { withFileTypes: true }).flatMap((d) => {
    const path = at ? `${at}/${d.name}` : d.name;
    if (d.isDirectory()) return filesUnder(root, path);
    return d.isFile() ? [path] : [];
  });
}

function plainApp(tmp: string): { app: string; arch: LinuxArch; version: string } {
  const artifacts = join(dir, "artifacts");
  const found = readdirSync(artifacts).flatMap((name) => {
    const arch = archOfArtifact(name);
    return arch ? [{ name, arch }] : [];
  });
  if (found.length !== 1) throw new Error(`package-linux: expected one stable-linux-*-Channels.tar.zst under ${artifacts}, found ${found.length}`);
  const { name, arch } = found[0]!;
  const tar = join(tmp, "app.tar");
  writeFileSync(tar, Bun.zstdDecompressSync(readFileSync(join(artifacts, name))));
  const into = join(tmp, "plain");
  mkdirSync(into);
  execFileSync("tar", ["-xf", tar, "-C", into]);
  rmSync(tar);
  const app = join(into, "Channels");
  if (!existsSync(join(app, "bin", "launcher"))) throw new Error(`package-linux: ${name} has no Channels/bin/launcher`);
  if (!existsSync(join(app, "bin", ELECTROBUN_LAUNCHER)))
    throw new Error(`package-linux: ${name} has no Channels/bin/${ELECTROBUN_LAUNCHER}, so its bin/launcher isn't the one that keeps the environment to an allowlist`);
  for (const path of LEFT_OUT) rmSync(join(app, path), { force: true });
  const { version } = JSON.parse(readFileSync(join(app, "Resources", "version.json"), "utf8")) as { version: unknown };
  if (typeof version !== "string") throw new Error(`package-linux: ${name}'s version.json names no version`);
  return { app, arch, version };
}

function icons(root: string, share: string): void {
  const from = join(desktop, "build", "icons");
  for (const name of readdirSync(from).filter((n) => /^\d+x\d+\.png$/.test(n))) {
    const at = join(root, share, "icons", "hicolor", name.replace(/\.png$/, ""), "apps");
    mkdirSync(at, { recursive: true });
    cpSync(join(from, name), join(at, `${EXECUTABLE}.png`));
  }
}

function deb(app: string, arch: LinuxArch, version: string, tmp: string): string {
  const root = join(tmp, "deb");
  cpSync(app, join(root, INSTALL_DIR), { recursive: true, verbatimSymlinks: true });
  mkdirSync(join(root, "usr", "bin"), { recursive: true });
  symlinkSync(`${INSTALL_DIR}/bin/launcher`, join(root, "usr", "bin", EXECUTABLE));
  mkdirSync(join(root, "usr", "share", "applications"), { recursive: true });
  writeFileSync(join(root, "usr", "share", "applications", `${EXECUTABLE}.desktop`), desktopEntry(`${INSTALL_DIR}/bin/launcher`));
  icons(root, "usr/share");
  mkdirSync(join(root, dirname(APPARMOR_SOURCE)), { recursive: true });
  writeFileSync(join(root, APPARMOR_SOURCE), APPARMOR);
  const { author } = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")) as { author: { name: string; email: string } };
  mkdirSync(join(root, "DEBIAN"));
  writeFileSync(join(root, "DEBIAN", "control"), debControl({ version, arch, maintainer: `${author.name} <${author.email}>`, installedKiB: sizeOf(root) / 1024 }));
  writeFileSync(
    join(root, "DEBIAN", "md5sums"),
    md5sums(
      filesUnder(root, "")
        .filter((f) => !f.startsWith("DEBIAN/"))
        .map((path) => ({ path, md5: new Bun.CryptoHasher("md5").update(readFileSync(join(root, path))).digest("hex") })),
    ),
  );
  for (const [hook, script] of [
    ["preinst", DEB_PREINST],
    ["postinst", DEB_POSTINST],
    ["postrm", DEB_POSTRM],
  ] as const) {
    writeFileSync(join(root, "DEBIAN", hook), script);
    chmodSync(join(root, "DEBIAN", hook), 0o755);
  }
  const file = join(out, debName(version, arch));
  execFileSync("dpkg-deb", ["--root-owner-group", "-Zxz", "-z9", "--build", root, file], { stdio: "inherit" });
  return file;
}

async function runtime(arch: LinuxArch): Promise<Buffer> {
  const res = await fetch(runtimeUrl(arch));
  if (!res.ok) throw new Error(`package-linux: the AppImage runtime didn't download (${res.status} from ${runtimeUrl(arch)})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const sum = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (sum !== RUNTIME_SHA256[arch]) throw new Error(`package-linux: the AppImage runtime's sha256 is ${sum}, not the pinned ${RUNTIME_SHA256[arch]}`);
  return bytes;
}

async function appImage(app: string, arch: LinuxArch, version: string, tmp: string): Promise<string> {
  const root = join(tmp, "AppDir");
  cpSync(app, join(root, "Channels"), { recursive: true, verbatimSymlinks: true });
  writeFileSync(join(root, "AppRun"), APP_RUN);
  chmodSync(join(root, "AppRun"), 0o755);
  writeFileSync(join(root, `${EXECUTABLE}.desktop`), desktopEntry(EXECUTABLE, version));
  cpSync(join(desktop, "build", "icons", "512x512.png"), join(root, `${EXECUTABLE}.png`));
  symlinkSync(`${EXECUTABLE}.png`, join(root, ".DirIcon"));
  icons(root, "usr/share");
  const squashfs = join(tmp, "app.squashfs");
  execFileSync("mksquashfs", [root, squashfs, "-root-owned", "-noappend", "-quiet", "-comp", "zstd", "-Xcompression-level", "19", "-b", "131072"], { stdio: "inherit" });
  const file = join(out, appImageName(version, arch));
  writeFileSync(file, Buffer.concat([await runtime(arch), readFileSync(squashfs)]));
  chmodSync(file, 0o755);
  return file;
}

const tmp = mkdtempSync(join(tmpdir(), "package-linux-"));
let over = 0;
try {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const { app, arch, version } = plainApp(tmp);
  console.log(`package-linux: Channels ${version} for linux-${arch}, ${(sizeOf(app) / MB).toFixed(1)}MB unpacked`);
  for (const file of [deb(app, arch, version, tmp), await appImage(app, arch, version, tmp)]) {
    const size = statSync(file).size;
    const fits = size <= MAX_DOWNLOAD;
    if (!fits) over++;
    console.log(`${file}: ${(size / MB).toFixed(1)}MB${fits ? "" : ` (over the ${MAX_DOWNLOAD / MB}MB download gate)`}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(over ? 1 : 0);
