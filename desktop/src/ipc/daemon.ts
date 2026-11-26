import type { DaemonStatus } from "../bridge.ts";
import { adoptDaemon, installCli } from "../bundled-daemon.ts";
import type { Serves } from "../calls.ts";
import { daemonHello } from "../daemon-client.ts";
import type { DeviceHost } from "../devices.ts";
import { readDoctorFindings } from "../doctor-view.ts";
import { osName } from "./devices.ts";
import { runKiwi } from "./kiwi.ts";
import { onlyArgs, readUpChoices, readUpOutcomes, readUpPicks } from "@kiwi/core/up-outcome.ts";

const BRING_BACK_MS = 10 * 60_000;
const PLAN_MS = 60_000;

export function daemonCalls(devices: DeviceHost): Serves<"daemonStatus" | "daemonAdopt" | "installCli" | "doctor" | "bringBack" | "upPlan" | "upChoices" | "bringBackOnly"> {
  return {
    daemonStatus: async (): Promise<DaemonStatus> => {
      const hello = await daemonHello();
      if (!hello) return { running: false };
      return { running: true, version: hello.version, machinePk: hello.machine.pk, pairedPerson: hello.paired ? { pk: hello.paired.person, name: hello.paired.name } : null };
    },
    daemonAdopt: () => adoptDaemon((m) => devices.addComputer({ ...m, os: osName() })),
    installCli: () => installCli(),
    doctor: async () => readDoctorFindings((await runKiwi(["doctor", "--json"])).stdout),
    bringBack: async () => readUpOutcomes((await runKiwi(["up", "--json"], BRING_BACK_MS)).stdout),
    upPlan: async () => readUpOutcomes((await runKiwi(["up", "--dry-run", "--json"], PLAN_MS)).stdout),
    upChoices: async () => readUpChoices((await runKiwi(["up", "--dry-run", "--json"], PLAN_MS)).stdout),
    bringBackOnly: async (given) => {
      const picks = readUpPicks(given);
      if (!picks) throw new Error("pick at least one seat to bring back");
      return readUpOutcomes((await runKiwi(["up", "--json", ...onlyArgs(picks)], BRING_BACK_MS)).stdout);
    },
  };
}
