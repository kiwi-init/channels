import { host } from "./host.ts";

export const JOIN_SCHEME = "kiwi";

const MAX_LINK = 2048;

let deepLink: string | null = null;
let opened = 0;

export const linksOpened = (): number => opened;

export function takeDeepLink(): string | null {
  const link = deepLink;
  deepLink = null;
  return link;
}

const opensChannel = (link: unknown): string | null => (typeof link === "string" && link.length <= MAX_LINK && link.startsWith(`${JOIN_SCHEME}://join/`) ? link : null);

export function handleDeepLink(url: string): void {
  if (!opensChannel(url)) return;
  opened += 1;
  deepLink = url;
  const shell = host();
  shell.push("deepLink", url);
  if (shell.app.ready()) shell.showWindow();
}
