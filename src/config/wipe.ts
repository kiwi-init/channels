import { rmSync } from "node:fs";
import { join } from "node:path";
import { blobDir, cachePath } from "./cache.ts";
import { cursorDir, cursorPath, seenPath } from "./cursors.ts";
import { dropSeats, loadConfig, updateConfig, type ChannelConfig } from "./file.ts";
import { forgetIdentity, identitiesIn, identityDir } from "./identities.ts";
import { home, safe } from "./paths.ts";

export function wipeChannel(alias: string): void {
  let c: ChannelConfig | undefined;
  updateConfig((cfg) => {
    c = cfg.channels[alias];
    delete cfg.channels[alias];
    if (cfg.default === alias) delete cfg.default;
    dropSeats(cfg, (b) => b.alias === alias);
  });
  if (c) {
    rmSync(identityDir(c.roomId), { recursive: true, force: true });
    for (const suffix of ["", ".seq", ".base"]) rmSync(cachePath(c.roomId) + suffix, { force: true });
    rmSync(join(home(), "downloads", c.roomId), { recursive: true, force: true });
    rmSync(join(home(), "answers", safe(c.roomId)), { recursive: true, force: true });
    rmSync(blobDir(c.roomId), { recursive: true, force: true });
  }
  rmSync(cursorDir(alias), { recursive: true, force: true });
}

export function forgetMember(alias: string, name: string): void {
  const c = loadConfig().channels[alias];
  if (!c) return;
  forgetIdentity(name, c.roomId);
  rmSync(cursorPath(alias, name), { force: true });
  rmSync(seenPath(alias, name), { force: true });
  const left = identitiesIn(c.roomId).filter((n) => n !== c.owner && n !== c.person);
  const ownerHere = !!c.owner && identitiesIn(c.roomId).includes(c.owner);
  const personHere = !!c.person && identitiesIn(c.roomId).includes(c.person);
  if (!left.length && !ownerHere && !personHere) return wipeChannel(alias);
  updateConfig((cfg) => {
    dropSeats(cfg, (b) => b.alias === alias && b.as === name);
    const ch = cfg.channels[alias];
    if (ch?.person === name) delete ch.person;
    if (ch?.as === name) ch.as = left[0] ?? ch.owner;
  });
}
