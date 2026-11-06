import { netHosts } from "@kiwi/core/node/mod-manifest.ts";

export function unapproved(needs: readonly string[], approved: readonly string[]): string[] {
  const yes = new Set(approved);
  return needs.filter((n) => !yes.has(n));
}

export function hostAllowed(url: string, needs: readonly string[], approved: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const host = u.hostname.toLowerCase();
  const ok = new Set(approved);
  return netHosts(needs).some((h) => h === host && ok.has(`net:${h}`));
}
