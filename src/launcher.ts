import { isAbsolute } from "node:path";

const from = process.env["KIWI_LAUNCHER_CWD"];
const via = process.env["KIWI_LAUNCHER"];
delete process.env["KIWI_LAUNCHER_CWD"];
delete process.env["KIWI_LAUNCHER"];

if (from !== undefined && isAbsolute(from))
  try {
    process.chdir(from);
    process.env["PWD"] = from;
  } catch {
    // The folder kiwi was started in is gone or closed to it: it carries on from /, where the launcher left it.
  }

export const launcher: string | null = via && isAbsolute(via) ? via : null;
