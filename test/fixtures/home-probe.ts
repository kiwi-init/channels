import { test } from "bun:test";

test("home probe", () => {
  console.log(`HOME_PROBE ${JSON.stringify({ kiwi: process.env.KIWI_HOME, claude: process.env.CLAUDE_CONFIG_DIR })}`);
});
