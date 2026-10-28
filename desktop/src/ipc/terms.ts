import type { Serves } from "../calls.ts";
import type { Host } from "../host.ts";
import { termClose, termKeys, termOpen, termSize } from "../terms.ts";

export function termsCalls(host: Host): Serves<"termOpen" | "termKeys" | "termSize" | "termClose"> {
  return {
    termOpen: (pane, cols, rows) => termOpen(pane, cols, rows, (e) => host.push("term", e)),
    termKeys: (term, keys) => termKeys(term, keys),
    termSize: (term, cols, rows) => termSize(term, cols, rows),
    termClose: (term) => termClose(term),
  };
}
