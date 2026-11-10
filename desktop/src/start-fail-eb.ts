import { Utils } from "electrobun/main";

import { logFile, logMainError } from "./main-log.ts";
import { messageBox } from "./message-box-eb.ts";
import { failing } from "./start-failure.ts";

export const { fail, releaseFirst } = failing({
  log: logMainError,
  say: (line) => console.error(line),
  box: messageBox,
  quit: (code) => Utils.quit(code),
  logFile,
});
