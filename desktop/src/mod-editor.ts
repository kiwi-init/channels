import path from "node:path";

export interface Opener {
  argv: string[];
  editor: string | null;
}

const MAC_EDITORS = [
  ["Cursor", "Cursor.app"],
  ["Visual Studio Code", "Visual Studio Code.app"],
  ["Zed", "Zed.app"],
  ["Windsurf", "Windsurf.app"],
  ["Sublime Text", "Sublime Text.app"],
] as const;

const LINUX_EDITORS = [
  ["Cursor", "cursor"],
  ["Visual Studio Code", "code"],
  ["Zed", "zed"],
  ["Zed", "zeditor"],
  ["Windsurf", "windsurf"],
  ["Sublime Text", "subl"],
] as const;

export function openerFor(dir: string, o: { platform: NodeJS.Platform; home: string; app: (at: string) => boolean; bin: (name: string) => string | null }): Opener {
  if (o.platform === "darwin") {
    for (const [editor, app] of MAC_EDITORS) {
      const at = [path.join("/Applications", app), path.join(o.home, "Applications", app)].find((p) => o.app(p));
      if (at) return { argv: ["/usr/bin/open", "-a", at, dir], editor };
    }
    return { argv: ["/usr/bin/open", dir], editor: null };
  }
  for (const [editor, name] of LINUX_EDITORS) {
    const bin = o.bin(name);
    if (bin) return { argv: [bin, dir], editor };
  }
  const xdg = o.bin("xdg-open");
  return { argv: xdg ? [xdg, dir] : [], editor: null };
}
