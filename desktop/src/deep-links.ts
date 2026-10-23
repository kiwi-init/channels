import { app } from "electron";

import { push, showWindow } from "./window.ts";

export const JOIN_SCHEME = "kiwi";

let deepLink: string | null = null;

export const pendingDeepLink = (): string | null => deepLink;

export function rememberDeepLink(url: string): void {
  deepLink = url;
}

export function takeDeepLink(): string | null {
  const link = deepLink;
  deepLink = null;
  return link;
}

export function handleDeepLink(url: string): void {
  if (!url.startsWith(`${JOIN_SCHEME}://join/`)) return;
  deepLink = url;
  push("deepLink", url);
  if (app.isReady()) showWindow();
}
