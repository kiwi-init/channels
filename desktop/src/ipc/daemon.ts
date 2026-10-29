import type { DaemonStatus } from "../bridge.ts";
import { adoptDaemon, installCli } from "../bundled-daemon.ts";
import type { Serves } from "../calls.ts";
import { daemonHello } from "../daemon-client.ts";
import type { DeviceHost } from "../devices.ts";
import { readDoctorFindings } from "../doctor-view.ts";
import { osName } from "./devices.ts";
import { runKiwi } from "./kiwi.ts";

export function daemonCalls(devices: DeviceHost): Serves<"daemonStatus" | "daemonAdopt" | "installCli" | "doctor"> {
  return {
    daemonStatus: async (): Promise<DaemonStatus> => {
      const hello = await daemonHello();
      if (!hello) return { running: false };
      return { running: true, version: hello.version, machinePk: hello.machine.pk, pairedPerson: hello.paired ? { pk: hello.paired.person, name: hello.paired.name } : null };
    },
    daemonAdopt: () => adoptDaemon((m) => devices.addComputer({ ...m, os: osName() })),
    installCli: () => installCli(),
    doctor: async () => readDoctorFindings((await runKiwi(["doctor", "--json"])).stdout),
  };
}
