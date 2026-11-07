import { useSyncExternalStore } from "react"

import type { ModGithub, ModTarget } from "~/mods/protocol"

export interface ModTabInfo {
  name: string
  title: string
  alert: string | null
  hint: string | null
}

interface Host {
  github: (data: ModGithub | null) => void
  show: (name: string, target: ModTarget, url: string | null) => boolean
  showTab: (name: string, target: ModTarget) => boolean
  rest: () => boolean
}

let tabs: readonly ModTabInfo[] = []
let wantsGithub = false
let idleOn = false
let host: Host | null = null
let github: ModGithub | null = null
const listeners = new Set<() => void>()

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function hostMods(next: Host | null): void {
  host = next
  next?.github(github)
}

export function publishTabs(next: readonly ModTabInfo[], github: boolean, idle: boolean): void {
  const same = JSON.stringify(next) === JSON.stringify(tabs) && github === wantsGithub && idle === idleOn
  tabs = next
  wantsGithub = github
  idleOn = idle
  if (!same) for (const l of listeners) l()
}

export const useModTabs = (): readonly ModTabInfo[] => useSyncExternalStore(subscribe, () => tabs)

export const useWantsGithub = (): boolean => useSyncExternalStore(subscribe, () => wantsGithub)

export const useIdleMod = (): boolean => useSyncExternalStore(subscribe, () => idleOn)

export const restInMod = (): boolean => host?.rest() ?? false

export function shareGithub(data: ModGithub | null): void {
  github = data
  host?.github(data)
}

export const showInMod = (name: string, target: ModTarget, url: string | null = null): boolean => host?.show(name, target, url) ?? false

export const showModTab = (name: string, target: ModTarget): boolean => host?.showTab(name, target) ?? false
