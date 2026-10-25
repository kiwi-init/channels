import path from "node:path";

const LIVEWIRE_KIWI_DIR = ".kiwi-livewire";

export function livewireKiwiEnv(env: NodeJS.ProcessEnv, home: string, testBuild: boolean): { KIWI_HOME: string; KIWI_INSTALL: string } {
  const kiwiHome = testBuild && env["KIWI_HOME"] ? env["KIWI_HOME"] : path.join(home, LIVEWIRE_KIWI_DIR);
  const install = testBuild && env["KIWI_INSTALL"] ? env["KIWI_INSTALL"] : path.join(kiwiHome, "bin");
  return { KIWI_HOME: kiwiHome, KIWI_INSTALL: install };
}
