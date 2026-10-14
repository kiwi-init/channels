// The app's own update, as the desktop shell reports it (desktop/src/updater.ts): a newer proper
// release being downloaded, ready to restart into, or only available. Nothing in a plain browser.

import { useEffect, useState } from "react"

import { bridge, type UpdateView } from "./secrets"

export type { UpdateView }

export function useUpdate(): UpdateView | null {
  const [u, setU] = useState<UpdateView | null>(null)
  useEffect(() => {
    const b = bridge()
    if (!b?.getUpdate) return
    void b.getUpdate().then((x) => x && setU(x))
    return b.onUpdate(setU)
  }, [])
  return u
}

export const restartToUpdate = () => void bridge()?.installUpdate()
export const openRelease = (u: UpdateView) => void bridge()?.openExternal(u.url)
