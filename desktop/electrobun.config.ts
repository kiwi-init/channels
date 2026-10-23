import type { ElectrobunConfig } from "electrobun";

import pkg from "./package.json" with { type: "json" };

export default {
  app: {
    name: "Channels",
    identifier: process.env.CHANNELS_EB_IDENTIFIER ?? (process.env.CHANNELS_EB_RELEASE === "1" ? "com.kiwiinit.channels" : "com.kiwiinit.channels.dev"),
    version: pkg.version,
  },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "src/main-eb.ts" },
    buildFolder: "release-eb/build",
    artifactFolder: "release-eb/artifacts",
    mac: { icons: "release-eb/icon.iconset" },
  },
  runtime: { exitOnLastWindowClosed: false },
  scripts: { preBuild: "./scripts/eb-pre-build.ts", postBuild: "./scripts/eb-post-build.ts" },
} satisfies ElectrobunConfig;
