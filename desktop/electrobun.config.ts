import type { ElectrobunConfig } from "electrobun";

import pkg from "./package.json" with { type: "json" };
import { RELEASE_ID, TEST_ID } from "./scripts/eb-bundle.ts";
import { JOIN_SCHEME } from "./src/deep-links.ts";
import { LIVEWIRE_ID, LIVEWIRE_NAME } from "./src/livewire-id.ts";

const identifier = process.env.CHANNELS_EB_TEST === "1" ? TEST_ID : (process.env.CHANNELS_EB_IDENTIFIER ?? (process.env.CHANNELS_EB_RELEASE === "1" ? LIVEWIRE_ID : `${LIVEWIRE_ID}.dev`));
const livewire = identifier === LIVEWIRE_ID || identifier === `${LIVEWIRE_ID}.dev`;

export default {
  app: {
    name: livewire ? LIVEWIRE_NAME : "Channels",
    identifier,
    version: pkg.version,
    ...(identifier === RELEASE_ID ? { urlSchemes: [JOIN_SCHEME] } : {}),
  },
  build: {
    // T892 spike: Cottontail is ~43 MB smaller than Bun 1.4.4 on Linux, ~27 MB on macOS.
    mainProcess: "cottontail",
    cottontail: { entrypoint: "src/main-eb.ts", define: { KIWI_EB_TEST: process.env.CHANNELS_EB_TEST === "1" ? "true" : "false", KIWI_EB_LIVEWIRE: livewire ? "true" : "false" } },
    views: { preload: { entrypoint: "src/preload-eb.ts" } },
    buildFolder: "release-eb/build",
    artifactFolder: "release-eb/artifacts",
    mac: { icons: "release-eb/icon.iconset" },
    copy: { assets: "assets" },
    linux: { icon: "build/icons/512x512.png" },
  },
  runtime: { exitOnLastWindowClosed: false },
  scripts: { preBuild: "./scripts/eb-pre-build.ts", postBuild: "./scripts/eb-post-build.ts" },
} satisfies ElectrobunConfig;
