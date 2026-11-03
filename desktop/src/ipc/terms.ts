import type { TermTabView } from "../bridge.ts";
import type { Serves } from "../calls.ts";
import type { Host } from "../host.ts";
import { MACHINE_PK } from "../launch-view.ts";
import type { Asker } from "../remote.ts";
import { remoteClose, remoteKeys, remoteSize, remoteTabClose, remoteTabs, termRemote } from "../remote-terms.ts";
import { personSigner, store } from "../store.ts";
import { termClose, termKeys, termMine, termOpen, termSize, termTabClose, termTabs } from "../terms.ts";

const asker = (): Asker => ({ ...personSigner(), relay: store.relayUrl });

function paired(machinePk: unknown): { pk: string; xpk: string } | null {
  if (typeof machinePk !== "string" || !MACHINE_PK.test(machinePk)) return null;
  const c = store.computers.find((x) => x.machinePk === machinePk && !x.own);
  return c ? { pk: c.machinePk, xpk: c.machineXpk } : null;
}

const none = async (): Promise<TermTabView[]> => [];

export function termsCalls(host: Host): Serves<"termOpen" | "termMine" | "termTabs" | "termTabClose" | "termRemote" | "termRemoteTabs" | "termRemoteClose" | "termKeys" | "termSize" | "termClose"> {
  return {
    termOpen: (pane, cols, rows) => termOpen(pane, cols, rows, (e) => host.push("term", e)),
    termMine: (roomId, want, cols, rows) => termMine(roomId, want, cols, rows, (e) => host.push("term", e)),
    termTabs: () => termTabs(),
    termTabClose: (pane) => termTabClose(pane),
    termRemote: async (machinePk, want, cols, rows) => {
      const m = paired(machinePk);
      return m ? termRemote(asker(), m, want, cols, rows, (e) => host.push("term", e)) : { ok: false, detail: "that isn't one of your computers" };
    },
    termRemoteTabs: (machinePk) => {
      const m = paired(machinePk);
      return m ? remoteTabs(asker(), m).catch(none) : none();
    },
    termRemoteClose: (machinePk, pane) => {
      const m = paired(machinePk);
      return m ? remoteTabClose(asker(), m, pane).catch(none) : none();
    },
    termKeys: (term, keys) => void (remoteKeys(term, keys) || termKeys(term, keys)),
    termSize: (term, cols, rows) => void (remoteSize(term, cols, rows) || termSize(term, cols, rows)),
    termClose: (term) => void (remoteClose(term) || termClose(term)),
  };
}
