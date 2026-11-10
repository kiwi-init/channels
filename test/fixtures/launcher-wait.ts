import { openedWithin } from "../../desktop/src/keyring-wait.ts";
import { launcherChannel, launcherKey } from "../../desktop/src/launcher-key.ts";

const ch = launcherChannel();
if (!ch) throw new Error("no key channel");
let ticks = 0;
const ticking = setInterval(() => ticks++, 10);
const getting = launcherKey(ch).get();
const inTime = await openedWithin(
  getting.then(() => {}),
  100,
);
const key = await getting;
clearInterval(ticking);
console.log(JSON.stringify({ inTime, ticks, key }));
process.exit(0);
