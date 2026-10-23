export type LinuxArch = "x64" | "arm64";

export const EXECUTABLE = "channels-desktop";
export const PACKAGE = "kiwi-desktop";
export const INSTALL_DIR = "/opt/Channels";
export const DEPENDS = ["libwebkit2gtk-4.1-0", "libgtk-3-0", "libayatana-appindicator3-1", "librsvg2-2"] as const;
export const MAX_DOWNLOAD = 40 * 1024 ** 2;
export const UPDATER_TOOLS = ["bspatch", "zig-zstd"] as const;

export const RUNTIME_RELEASE = "20251108";
export const RUNTIME_SHA256: Record<LinuxArch, string> = {
  x64: "2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d",
  arm64: "00cbdfcf917cc6c0ff6d3347d59e0ca1f7f45a6df1a428a0d6d8a78664d87444",
};

export const debArch = (arch: LinuxArch): string => (arch === "x64" ? "amd64" : "arm64");
export const appImageArch = (arch: LinuxArch): string => (arch === "x64" ? "x86_64" : "aarch64");
export const debName = (version: string, arch: LinuxArch): string => `Channels-${version}-linux-${debArch(arch)}.deb`;
export const appImageName = (version: string, arch: LinuxArch): string => `Channels-${version}-linux-${appImageArch(arch)}.AppImage`;
export const runtimeUrl = (arch: LinuxArch): string => `https://github.com/AppImage/type2-runtime/releases/download/${RUNTIME_RELEASE}/runtime-${appImageArch(arch)}`;

export function archOfArtifact(name: string): LinuxArch | null {
  const m = /^stable-linux-(x64|arm64)-Channels\.tar\.zst$/.exec(name);
  return m ? (m[1] as LinuxArch) : null;
}

export function desktopEntry(exec: string, version?: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Channels",
    "Comment=Agents and people working together in end-to-end encrypted channels",
    `Exec=${exec} %U`,
    `Icon=${EXECUTABLE}`,
    "Terminal=false",
    "StartupWMClass=Channels",
    "Categories=Utility;",
    "MimeType=x-scheme-handler/kiwi;",
    ...(version ? [`X-AppImage-Version=${version}`] : []),
    "",
  ].join("\n");
}

export function debControl({ version, arch, maintainer, installedKiB }: { version: string; arch: LinuxArch; maintainer: string; installedKiB: number }): string {
  return [
    `Package: ${PACKAGE}`,
    `Version: ${version}`,
    `Architecture: ${debArch(arch)}`,
    `Maintainer: ${maintainer}`,
    `Installed-Size: ${Math.ceil(installedKiB)}`,
    `Depends: ${DEPENDS.join(", ")}`,
    "Section: utils",
    "Priority: optional",
    "Homepage: https://channels.kiwiinit.com",
    "Description: Channels desktop app",
    " Agents and people working together in end-to-end encrypted channels.",
    "",
  ].join("\n");
}

export const DEB_REFRESH = [
  "#!/bin/sh",
  "set -e",
  "if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database -q /usr/share/applications || true; fi",
  "if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true; fi",
  "",
].join("\n");

export const APP_RUN = ["#!/bin/sh", 'HERE="$(dirname "$(readlink -f "$0")")"', 'exec "$HERE/Channels/bin/launcher" "$@"', ""].join("\n");
