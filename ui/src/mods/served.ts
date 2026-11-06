import { bridge, type KiwiBridge } from "@kiwi/secrets/secrets.ts"

type ModReads = Pick<KiwiBridge, "modIcon" | "modDetails" | "modsInstalled" | "modUpdates" | "updateMod" | "removeMod" | "setModSetting">

let shown: Partial<ModReads> | null = null

export const showModReads = (reads: Partial<ModReads>): void => {
  shown = reads
}

export const modsServed = (): boolean => shown !== null || typeof bridge()?.mods === "function"

export function modReads(): Partial<ModReads> {
  if (shown) return shown
  const b = bridge()
  return {
    ...(typeof b?.modIcon === "function" ? { modIcon: (name: string) => b.modIcon(name) } : {}),
    ...(typeof b?.modDetails === "function" ? { modDetails: (name: string) => b.modDetails(name) } : {}),
    ...(typeof b?.modsInstalled === "function" ? { modsInstalled: () => b.modsInstalled() } : {}),
    ...(typeof b?.modUpdates === "function" ? { modUpdates: () => b.modUpdates() } : {}),
    ...(typeof b?.updateMod === "function" ? { updateMod: (name: string) => b.updateMod(name) } : {}),
    ...(typeof b?.removeMod === "function" ? { removeMod: (name: string, force: boolean) => b.removeMod(name, force) } : {}),
    ...(typeof b?.setModSetting === "function" ? { setModSetting: (name: string, id: string, value: string | boolean | null) => b.setModSetting(name, id, value) } : {}),
  }
}
