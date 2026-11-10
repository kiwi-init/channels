import { join } from "node:path";

import { keepEntry } from "../src/linux-entry.ts";

const [appDir, home] = process.argv.slice(2);
if (!appDir || !home) throw new Error("usage: icon-theme-install.ts APPDIR HOME");
const kept = keepEntry({ appImage: join(home, "Channels.AppImage"), appDir, dataHome: join(home, "data"), configHome: join(home, "config"), fuse: true });
if (kept.kind !== "kept") throw new Error(`icon-theme-install.ts: keepEntry skipped: ${kept.why}`);
for (const file of kept.wrote) console.log(file);
