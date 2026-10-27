import { errorText } from "./guard.ts";
import { keySources, type KeySources } from "./launcher-key.ts";
import { LIVEWIRE_NAME } from "./livewire-id.ts";

declare const KIWI_EB_LIVEWIRE: boolean;

export const launcherKeys: KeySources | Error = (() => {
  try {
    return keySources(process.platform, process.env, KIWI_EB_LIVEWIRE ? LIVEWIRE_NAME : "Channels");
  } catch (e) {
    return new Error(errorText(e));
  }
})();
