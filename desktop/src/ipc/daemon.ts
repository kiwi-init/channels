import { ipcMain } from "electron";

import type { DaemonStatus } from "../bridge.ts";
import { adoptDaemon, installCli } from "../bundled-daemon.ts";
import { daemonHello } from "../daemon-client.ts";

export function wireDaemonIpc(): void {
  ipcMain.handle("kiwi:daemon-status", async (): Promise<DaemonStatus> => {
    const hello = await daemonHello();
    if (!hello) return { running: false };
    return { running: true, version: hello.version, machinePk: hello.machine.pk, pairedPerson: hello.paired ? { pk: hello.paired.person, name: hello.paired.name } : null };
  });
  ipcMain.handle("kiwi:daemon-adopt", () => adoptDaemon());
  ipcMain.handle("kiwi:install-cli", () => installCli());
}
