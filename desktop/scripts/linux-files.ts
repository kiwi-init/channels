export type LinuxArch = "x64" | "arm64";

export const EXECUTABLE = "channels-livewire";
export const PACKAGE = "channels-livewire";
export const APP_FOLDER = "ChannelsLivewire";
export const INSTALL_DIR = `/opt/${APP_FOLDER}`;
export const ELECTROBUN_LAUNCHER = "electrobun-launcher";
export const DEPENDS = ["libwebkit2gtk-4.1-0", "libgtk-3-0", "libayatana-appindicator3-1", "librsvg2-2", "bubblewrap", "xdg-dbus-proxy"] as const;
export const MAX_DOWNLOAD = 55 * 1024 ** 2;
export const LEFT_OUT = ["bin/bspatch", "bin/zig-zstd", "Resources/uninstall", `${APP_FOLDER}.desktop`] as const;

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
  const m = new RegExp(`^stable-linux-(x64|arm64)-${APP_FOLDER}\\.tar\\.zst$`).exec(name);
  return m ? (m[1] as LinuxArch) : null;
}

export function desktopEntry(exec: string, version?: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Channels Livewire",
    "Comment=Agents and people working together in end-to-end encrypted channels",
    `Exec=${exec} %U`,
    `Icon=${EXECUTABLE}`,
    "Terminal=false",
    `StartupWMClass=${APP_FOLDER}`,
    "Categories=Utility;",
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
    "Description: Channels Livewire desktop app",
    " A release candidate of Channels on Electrobun Livewire, installed beside Channels.",
    "",
  ].join("\n");
}

const REFRESH = [
  "if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database -q /usr/share/applications || true; fi",
  "if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true; fi",
];

export const DEB_PREINST = [
  "#!/bin/sh",
  "set -e",
  'case "$1" in',
  `  install|upgrade) if command -v update-alternatives >/dev/null 2>&1; then update-alternatives --remove-all ${EXECUTABLE} >/dev/null 2>&1 || true; fi ;;`,
  "esac",
  "",
].join("\n");

export const DEB_POSTINST = ["#!/bin/sh", "set -e", `[ -e /usr/bin/${EXECUTABLE} ] || ln -sf ${INSTALL_DIR}/bin/launcher /usr/bin/${EXECUTABLE}`, ...REFRESH, ""].join("\n");

export const DEB_POSTRM = ["#!/bin/sh", "set -e", ...REFRESH, ""].join("\n");

export function md5sums(files: readonly { path: string; md5: string }[]): string {
  return files.map((f) => `${f.md5}  ${f.path.replace(/^\/+/, "")}\n`).join("");
}

export const APP_RUN = ["#!/bin/sh", 'HERE="$(dirname "$(readlink -f "$0")")"', `exec "$HERE/${APP_FOLDER}/bin/launcher" "$@"`, ""].join("\n");
