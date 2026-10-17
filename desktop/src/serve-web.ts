import fs from "node:fs";
import path from "node:path";
import { app, protocol } from "electron";

import { APP_HOST, APP_SCHEME, csp, fileFor } from "./guard.ts";
import { store } from "./store.ts";
import { voiceOriginsFor } from "./voice.ts";

const webDist = () => path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, ".."), app.isPackaged ? "web/dist" : "../web/dist");

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

const webHeaders = (type: string): Record<string, string> => ({
  "content-type": type,
  "content-security-policy": csp(store.relayUrl, voiceOriginsFor(store.voice)),
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
});

export function serveWeb(): void {
  protocol.handle(APP_SCHEME, (req) => {
    const u = new URL(req.url);
    const file = u.host === APP_HOST ? fileFor(webDist(), u.pathname) : null;
    if (!file) return new Response("not found", { status: 404 });
    try {
      const body = fs.readFileSync(file);
      return new Response(new Uint8Array(body), { headers: webHeaders(MIME[path.extname(file)] ?? "application/octet-stream") });
    } catch {
      if (path.basename(file) !== "index.html") return serveWebFallback();
      return new Response("not found", { status: 404 });
    }
  });
}

function serveWebFallback(): Response {
  try {
    const body = fs.readFileSync(path.join(webDist(), "index.html"));
    return new Response(new Uint8Array(body), { headers: webHeaders("text/html") });
  } catch {
    return new Response("run `bun run web:build` in the repo root first", { status: 500 });
  }
}

export const entryUrl = () => `${APP_SCHEME}://${APP_HOST}/index.html`;
