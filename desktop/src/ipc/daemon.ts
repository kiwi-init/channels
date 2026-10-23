import type { DaemonStatus } from "../bridge.ts";
import { adoptDaemon, installCli } from "../bundled-daemon.ts";
import type { Serves } from "../calls.ts";
import { daemonHello } from "../daemon-client.ts";

export function daemonCalls(): Serves<"daemonStatus" | "daemonAdopt" | "installCli"> {
  return {
    daemonStatus: async (): Promise<DaemonStatus> => {
      const hello = await daemonHello();
      if (!hello) return { running: false };
      return { running: true, version: hello.version, machinePk: hello.machine.pk, pairedPerson: hello.paired ? { pk: hello.paired.person, name: hello.paired.name } : null };
    },
    daemonAdopt: () => adoptDaemon(),
    installCli: () => installCli(),
  };
}
