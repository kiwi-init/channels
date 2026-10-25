import fs from "node:fs";
import path from "node:path";

import pkg from "../package.json" with { type: "json" };
import { UI_CONTRACT, UI_DATA_SCHEMA } from "../src/ui-contract.ts";

export interface UiJson {
  uiVersion: string;
  requiresContract: string;
  dataSchema: number;
}

export const SKIPPED = new Set(["_headers"]);

export function uiJson(sha: string): UiJson {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error(`${sha} isn't a commit sha`);
  return { uiVersion: `${pkg.version}-${sha.slice(0, 10)}`, requiresContract: `^${UI_CONTRACT}`, dataSchema: UI_DATA_SCHEMA };
}

export function stageUi(dist: string, out: string, sha: string): UiJson {
  if (!fs.existsSync(path.join(dist, "index.html"))) throw new Error(`${dist}/index.html is missing: run \`bun run web:build\` in the repo root first`);
  if (fs.existsSync(out)) throw new Error(`${out} already exists`);
  fs.cpSync(dist, out, { recursive: true, filter: (src) => !SKIPPED.has(path.basename(src)) });
  const json = uiJson(sha);
  fs.writeFileSync(path.join(out, "ui.json"), `${JSON.stringify(json, null, 2)}\n`);
  return json;
}

if (import.meta.main) {
  const [dist, out, sha] = process.argv.slice(2);
  if (!dist || !out || !sha) {
    console.error("usage: bun desktop/scripts/ui-stage.ts WEB_DIST OUT SHA");
    process.exit(2);
  }
  const json = stageUi(dist, out, sha);
  console.log(`staged ${json.uiVersion} (contract ${json.requiresContract}, data schema ${json.dataSchema}) in ${out}`);
}
