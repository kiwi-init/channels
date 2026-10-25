import path from "node:path";

const LIVEWIRE_KIWI_DIR = ".kiwi-livewire";

export function livewireKiwiEnv(home: string, testBuild: boolean): Record<string, string> {
  if (testBuild) return {};
  const kiwiHome = path.join(home, LIVEWIRE_KIWI_DIR);
  return { KIWI_HOME: kiwiHome, KIWI_INSTALL: path.join(kiwiHome, "bin") };
}
