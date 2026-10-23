import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { MB, mb, sizeOf, stableBuild, unpackApp } from "./eb-app.ts";

const LIMITS = { app: 100 * MB, packed: 40 * MB };

const dir = resolve(process.argv[2] ?? "desktop/release-eb");
const { wrapper, wrapperDmg, payload } = stableBuild(dir);

const tmp = mkdtempSync(join(tmpdir(), "eb-size-"));
try {
  const app = unpackApp(payload, join(tmp, "app"));
  const zip = join(tmp, "Channels.zip");
  execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
  const dmg = join(tmp, "Channels.dmg");
  execFileSync("hdiutil", ["create", "-quiet", "-volname", "Channels", "-srcfolder", app, "-format", "ULMO", "-o", dmg]);

  const gated = [
    { what: "the app (.app on disk)", bytes: sizeOf(app), limit: LIMITS.app },
    { what: "its dmg (hdiutil ULMO)", bytes: sizeOf(dmg), limit: LIMITS.packed },
    { what: "its zip (ditto, the updater's layout)", bytes: sizeOf(zip), limit: LIMITS.packed },
  ];
  const told = [
    { what: "Electrobun's self-extracting wrapper .app, not shipped", bytes: sizeOf(wrapper) },
    { what: "Electrobun's dmg of that wrapper, not shipped", bytes: sizeOf(wrapperDmg) },
  ];
  let over = 0;
  for (const f of gated) {
    console.log(`${mb(f.bytes).padStart(9)}  ${f.what}  (gate ${mb(f.limit)}: ${f.bytes > f.limit ? "OVER" : "ok"})`);
    if (f.bytes > f.limit) over++;
  }
  for (const f of told) console.log(`${mb(f.bytes).padStart(9)}  ${f.what}`);
  process.exitCode = over ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
