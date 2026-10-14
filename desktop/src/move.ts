// Putting a downloaded file where it belongs. A rename is atomic, but only within one filesystem, and
// a download in the system's temp dir (a tmpfs on many Linux systems) is often on another one than
// the AppImage it replaces: there renameSync fails with EXDEV. No electron, so bun test can check it.

import fs from "node:fs";

/**
 * Move `from` over `to`: a rename where one works; across filesystems a copy beside `to`, renamed
 * over it (so `to` is never half written), then `from` goes. Keeps `from`'s mode.
 */
export function moveOver(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
  }
  const tmp = `${to}.new-${process.pid}`;
  try {
    fs.copyFileSync(from, tmp);
    fs.chmodSync(tmp, fs.statSync(from).mode & 0o7777);
    fs.renameSync(tmp, to);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  fs.rmSync(from, { force: true });
}
