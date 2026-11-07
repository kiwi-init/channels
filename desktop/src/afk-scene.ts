import fs from "node:fs";
import path from "node:path";

import type { AfkScene } from "./bridge.ts";
import { writePrivate } from "./guard.ts";

export const AFK_SCENE_BYTES = 8 * 1024 * 1024;

export interface AfkSceneHome {
  home: string;
  record: string;
}

export const afkSceneFile = (home: string): string => path.join(home, "afk", "scene.html");

const written = (o: AfkSceneHome): boolean => fs.existsSync(o.record);

function readScene(file: string): string | null {
  const at = fs.statSync(file, { throwIfNoEntry: false });
  if (!at?.isFile() || at.size === 0 || at.size > AFK_SCENE_BYTES) return null;
  return fs.readFileSync(file, "utf8");
}

export function afkScene(o: AfkSceneHome): AfkScene {
  const file = afkSceneFile(o.home);
  const html = readScene(file);
  if (html !== null && !written(o)) writePrivate(o.record, Buffer.from(`${JSON.stringify({ written: true })}\n`));
  return { html, first: html === null && !written(o) && !fs.existsSync(file) };
}

export function keepAfkScene(o: AfkSceneHome, html: string): string | null {
  const file = afkSceneFile(o.home);
  if (written(o) || fs.existsSync(file)) return readScene(file);
  if (typeof html !== "string" || !html.trim() || Buffer.byteLength(html) > AFK_SCENE_BYTES) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  writePrivate(o.record, Buffer.from(`${JSON.stringify({ written: true })}\n`));
  return html;
}
