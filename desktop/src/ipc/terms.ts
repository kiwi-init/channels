import type { Serves } from "../calls.ts";
import type { Host } from "../host.ts";
import { termClose, termKeys, termMine, termOpen, termSize, termTabClose, termTabs } from "../terms.ts";

export function termsCalls(host: Host): Serves<"termOpen" | "termMine" | "termTabs" | "termTabClose" | "termKeys" | "termSize" | "termClose"> {
  return {
    termOpen: (pane, cols, rows) => termOpen(pane, cols, rows, (e) => host.push("term", e)),
    termMine: (roomId, want, cols, rows) => termMine(roomId, want, cols, rows, (e) => host.push("term", e)),
    termTabs: () => termTabs(),
    termTabClose: (pane) => termTabClose(pane),
    termKeys: (term, keys) => termKeys(term, keys),
    termSize: (term, cols, rows) => termSize(term, cols, rows),
    termClose: (term) => termClose(term),
  };
}
