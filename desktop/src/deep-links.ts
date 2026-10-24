import { host } from "./host.ts";

export const JOIN_SCHEME = "kiwi";

let deepLink: string | null = null;

export function takeDeepLink(): string | null {
  const link = deepLink;
  deepLink = null;
  return link;
}

export function handleDeepLink(url: string): void {
  if (!url.startsWith(`${JOIN_SCHEME}://join/`)) return;
  deepLink = url;
  const shell = host();
  shell.push("deepLink", url);
  if (shell.app.ready()) shell.showWindow();
}
