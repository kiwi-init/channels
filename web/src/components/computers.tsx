import { useState } from "react"

import { clockNow } from "@kiwi/channel/clock.ts"
import { cx } from "@/lib/utils"
import { useMachinesOnline } from "@/lib/launches"
import { adoptThisComputer, removeComputer, type ComputerView } from "@/lib/computers"
import { formatAgo } from "@/lib/format"
import { bridge, useSecrets } from "@kiwi/secrets/secrets.ts"
import { RemoteSettings } from "./computer-settings"
import { Button, Modal, errorText, toast } from "./kit"

/** Your computers: remove one (and its agents from your channels). */
export function ComputerRows() {
  const { computers } = useSecrets()
  const online = useMachinesOnline()
  const [removing, setRemoving] = useState<string | null>(null)
  const inApp = !!bridge()
  const [adoptingHere, setAdoptingHere] = useState(false)
  const addHere = async () => {
    setAdoptingHere(true)
    try {
      const c = await adoptThisComputer()
      if (c) toast(`Added ${c.label}`)
    } catch (err) {
      toast(`Not added: ${errorText(err)}`, "error")
    } finally {
      setAdoptingHere(false)
    }
  }

  const remove = async (c: ComputerView) => {
    setRemoving(c.machinePk)
    try {
      const gone = await removeComputer(c.machinePk)
      toast(`Removed ${c.label}${gone.length ? `, and ${gone.length === 1 ? "its agent" : `its ${gone.length} agents`} in your channels` : ""}`)
    } catch (err) {
      toast(errorText(err), "error")
    } finally {
      setRemoving(null)
    }
  }

  return (
    <>
      {inApp && !computers.some((c) => c.own) && (
        <div className="flex items-center gap-3 rounded-ctl py-1.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-ui font-medium">This computer</p>
            <p className="text-meta text-ink-3">Not added yet, so its agents ask to join like anyone else’s.</p>
          </div>
          <Button size="sm" variant="secondary" disabled={adoptingHere} onClick={() => void addHere()}>
            Add this computer
          </Button>
        </div>
      )}
      {!inApp && computers.length === 0 && <p className="text-ui text-ink-3">None yet.</p>}
      {computers.map((c) => (
        <div key={c.machinePk}>
          <div className="flex items-center gap-3 rounded-ctl py-1.5">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-ui font-medium">
                {online.has(c.machinePk) && online.get(c.machinePk) !== null && (
                  <span aria-label={online.get(c.machinePk) ? "Online" : "Offline"} className={cx("size-2 shrink-0 rounded-full", online.get(c.machinePk) ? "bg-live" : "bg-wash-2")} />
                )}
                {c.label}
                {c.own && <span className="font-normal text-ink-3"> · this computer</span>}
              </p>
              <p className="text-meta text-ink-3">
                {c.os} · added {formatAgo(c.at, clockNow())}
              </p>
            </div>
            <Button size="sm" variant="danger" disabled={removing === c.machinePk} onClick={() => void remove(c)}>
              Remove
            </Button>
          </div>
          {!c.own && <RemoteSettings machinePk={c.machinePk} label={c.label} />}
        </div>
      ))}
    </>
  )
}

export function ComputersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} closeLabel="Close Your computers">
      <div className="p-5">
        <h2 className="text-title font-semibold">Your computers</h2>
        <p className="mt-1 text-ui leading-normal text-ink-2">
          Agents on one of your computers join your channels as yours: Channels lets them in on its own while it runs. To add a computer, run kiwi login on it and type the digits it shows here.
          Removing a computer also takes its agents out of the channels you own.
        </p>
        <div className="mt-4 grid gap-1">
          <ComputerRows />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  )
}
