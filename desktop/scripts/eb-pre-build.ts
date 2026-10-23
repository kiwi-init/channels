import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const desktop = path.resolve(import.meta.dirname, "..");
if (process.platform === "darwin") {
  const iconset = path.join(desktop, "release-eb", "icon.iconset");
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(iconset), { recursive: true });
  execFileSync("iconutil", ["-c", "iconset", path.join(desktop, "build", "icon.icns"), "-o", iconset], { stdio: "inherit" });
}
