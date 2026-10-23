import type { ElectrobunConfig } from "electrobun";

import pkg from "./package.json" with { type: "json" };

export default {
  app: {
    name: "Channels",
    identifier: process.env.CHANNELS_EB_IDENTIFIER ?? "com.kiwiinit.channels",
    version: pkg.version,
  },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "src/main-eb.ts" },
    buildFolder: "release-eb/build",
    artifactFolder: "release-eb/artifacts",
    mac: { icons: "release-eb/icon.iconset" },
    copy: { assets: "assets" },
  },
  runtime: { exitOnLastWindowClosed: false },
  scripts: { preBuild: "./scripts/eb-pre-build.ts", postBuild: "./scripts/eb-post-build.ts" },
} satisfies ElectrobunConfig;
