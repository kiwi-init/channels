import type { ElectrobunConfig } from "electrobun";

import pkg from "./package.json" with { type: "json" };

const test = process.env.CHANNELS_EB_TEST === "1";
const out = test ? "release-eb-test" : "release-eb";

export default {
  app: {
    name: "Channels",
    identifier: test ? "com.kiwiinit.channels.test" : (process.env.CHANNELS_EB_IDENTIFIER ?? "com.kiwiinit.channels"),
    version: pkg.version,
  },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "src/main-eb.ts", define: { KIWI_EB_TEST: test ? "true" : "false" } },
    buildFolder: `${out}/build`,
    artifactFolder: `${out}/artifacts`,
    mac: { icons: "release-eb/icon.iconset" },
  },
  runtime: { exitOnLastWindowClosed: false },
  scripts: { preBuild: "./scripts/eb-pre-build.ts", postBuild: "./scripts/eb-post-build.ts" },
} satisfies ElectrobunConfig;
