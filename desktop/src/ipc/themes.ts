import type { Serves } from "../calls.ts";
import { kiwiHome } from "../daemon-client.ts";
import type { Host } from "../host.ts";
import { logMainError } from "../main-log.ts";
import { watchFolder } from "../json-folder.ts";
import { readFolder, removeTheme, themesDir, writeTheme } from "../theme-folder.ts";

export function themesCalls(host: Host, home: () => string = kiwiHome): Serves<"folderThemes" | "saveFolderTheme" | "deleteFolderTheme"> {
  const dir = () => themesDir(home());
  let stop: (() => void) | null = null;
  const watch = () => {
    if (stop) return;
    try {
      stop = watchFolder(
        dir(),
        () => host.push("folderThemes", readFolder(dir())),
        () => (stop = null),
      );
    } catch (err) {
      // Without a watch the themes still load on each call; only live changes wait for the next one.
      logMainError(new Error(`couldn't watch ${dir()}`, { cause: err }));
    }
  };
  return {
    folderThemes: () => {
      watch();
      return readFolder(dir());
    },
    saveFolderTheme: (file, theme) => {
      const saved = writeTheme(dir(), file, theme);
      return { file: saved, view: readFolder(dir()) };
    },
    deleteFolderTheme: (file) => {
      removeTheme(dir(), file);
      return readFolder(dir());
    },
  };
}
