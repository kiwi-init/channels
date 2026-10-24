import { errorText } from "./guard.ts";
import { keySources, type KeySources } from "./launcher-key.ts";

export const launcherKeys: KeySources | Error = (() => {
  try {
    return keySources();
  } catch (e) {
    return new Error(errorText(e));
  }
})();
