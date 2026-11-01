import type { ElectrobunConfig } from "electrobun";

import pkg from "./package.json" with { type: "json" };
import { RELEASE_ID, TEST_ID } from "./scripts/eb-bundle.ts";
import { JOIN_SCHEME } from "./src/deep-links.ts";

const DEV_ID = `${RELEASE_ID}.dev`;
const identifier = process.env.CHANNELS_EB_TEST === "1" ? TEST_ID : (process.env.CHANNELS_EB_IDENTIFIER ?? (process.env.CHANNELS_EB_RELEASE === "1" ? RELEASE_ID : DEV_ID));
const officialUi = identifier === RELEASE_ID || identifier === DEV_ID;
const devBuild = identifier === DEV_ID || process.env.CHANNELS_EB_LOCAL_UI === "1";

export default {
  app: {
    name: "Channels",
    identifier,
    version: pkg.version,
    ...(identifier === RELEASE_ID ? { urlSchemes: [JOIN_SCHEME] } : {}),
  },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint: "src/main-eb.ts",
      define: {
        KIWI_EB_TEST: process.env.CHANNELS_EB_TEST === "1" ? "true" : "false",
        KIWI_EB_OFFICIAL_UI: officialUi ? "true" : "false",
        KIWI_EB_DEV: devBuild ? "true" : "false",
        KIWI_UI_SEQ: String(Date.now()),
      },
    },
    views: { preload: { entrypoint: "src/preload-eb.ts" } },
    buildFolder: "release-eb/build",
    artifactFolder: "release-eb/artifacts",
    mac: { icons: "release-eb/icon.iconset" },
    copy: { assets: "assets" },
    linux: { icon: "build/icons/512x512.png" },
  },
  runtime: { exitOnLastWindowClosed: false, inspector: devBuild },
  scripts: { preBuild: "./scripts/eb-pre-build.ts", postBuild: "./scripts/eb-post-build.ts" },
} satisfies ElectrobunConfig;
