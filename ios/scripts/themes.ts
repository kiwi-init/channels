import { writeFileSync } from "node:fs";

import { CHANNELS_DARK, CHANNELS_LIGHT, CHANNELS_OLED, CINDER_PEAK } from "../../ui/src/theme/channels.ts";
import { REX_THEMES } from "../../ui/src/theme/rex-themes.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: bun ios/scripts/themes.ts OUT.json");

const themes = [CINDER_PEAK, CHANNELS_OLED, CHANNELS_DARK, CHANNELS_LIGHT, ...REX_THEMES].map((t) => ({
  id: t.id,
  name: t.name,
  appearance: t.appearance,
  colors: t.colors,
}));
writeFileSync(out, JSON.stringify(themes));
