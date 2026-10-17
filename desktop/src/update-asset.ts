export function swapAsset(version: string, platform: NodeJS.Platform, arch: string): string | null {
  if (platform === "darwin") return `Channels-${version}-mac-${arch === "arm64" ? "arm64" : "x64"}.zip`;
  return null;
}
