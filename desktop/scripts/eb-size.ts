import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { MB, mb, only, payloadOf, shippedApp, sizeOf } from "./eb-app.ts";
import { makeDmg } from "./eb-dmg.ts";

const LIMITS = { app: 120 * MB, packed: 60 * MB };

const dir = resolve(process.argv[2] ?? "desktop/release-eb");
const builds = join(dir, "build");
const artifacts = join(dir, "artifacts");
const wrapper = only(
  readdirSync(builds)
    .filter((name) => name.startsWith("stable-macos-"))
    .flatMap((name) =>
      readdirSync(join(builds, name))
        .filter((n) => n.endsWith(".app"))
        .map((app) => join(builds, name, app)),
    ),
  `stable Mac .app under ${builds}`,
);
const wrapperDmg = only(
  readdirSync(artifacts)
    .filter((name) => name.endsWith(".dmg"))
    .map((name) => join(artifacts, name)),
  `.dmg under ${artifacts}`,
);
const payload = payloadOf(artifacts);

const tmp = mkdtempSync(join(tmpdir(), "eb-size-"));
try {
  const app = shippedApp(payload, tmp);
  const zip = join(tmp, "Channels.zip");
  execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
  const dmg = join(tmp, "Channels.dmg");
  makeDmg(app, dmg);

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
