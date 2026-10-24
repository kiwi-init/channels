import { useEffect, useState } from "react"

import type { KiwiBridge } from "./secrets"

type Launcher = Pick<KiwiBridge, "harnesses" | "seatFolders" | "chooseFolder" | "launchAgent"> & Partial<Pick<KiwiBridge, "machines" | "harnessesOn" | "foldersOn">>

export function launcher(): Launcher | null {
  try {
    const k = (window as unknown as { kiwi?: Partial<Launcher> }).kiwi
    return k && typeof k.harnesses === "function" && typeof k.seatFolders === "function" && typeof k.chooseFolder === "function" && typeof k.launchAgent === "function" ? (k as Launcher) : null
  } catch {
    // No window (a test or a worker): nothing can start an agent.
    return null
  }
}

type Roots = Pick<KiwiBridge, "launchRoots" | "setLaunchRoot" | "chooseFolder">

export function rootsBridge(): Roots | null {
  try {
    const k = (window as unknown as { kiwi?: Partial<Roots> }).kiwi
    return k && typeof k.launchRoots === "function" && typeof k.setLaunchRoot === "function" && typeof k.chooseFolder === "function" ? (k as Roots) : null
  } catch {
    // No window (a test or a worker): no folders to add.
    return null
  }
}

export function canStartAgents(): boolean {
  return launcher() !== null
}

export function useMachinesOnline(): ReadonlyMap<string, boolean | null> {
  const [online, setOnline] = useState<ReadonlyMap<string, boolean | null>>(new Map())
  useEffect(() => {
    const list = launcher()?.machines
    if (!list) return
    let live = true
    const load = () =>
      void list().then(
        (ms) => live && setOnline(new Map(ms.map((m) => [m.machinePk, m.online]))),
        () => {}
      )
    load()
    window.addEventListener("focus", load)
    return () => {
      live = false
      window.removeEventListener("focus", load)
    }
  }, [])
  return online
}
