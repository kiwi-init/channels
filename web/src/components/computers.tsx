import { useEffect, useState } from "react"

import { clockNow } from "@/lib/channel"
import { cx } from "@/lib/utils"
import { useMachinesOnline } from "@/lib/launches"
import { adoptThisComputer, beginPairing, pairCommands, removeComputer, type ComputerView, type PairAskView, type Pairing } from "@/lib/computers"
import { formatAgo } from "@/lib/format"
import { bridge, useSecrets } from "@/lib/secrets"
import { Command } from "./add-agent"
import { RemoteSettings } from "./computer-settings"
import { Button, Modal, Spinner, errorText, toast } from "./kit"

type Adding = { kind: "starting" } | { kind: "waiting"; pairing: Pairing } | { kind: "confirm"; pairing: Pairing; ask: PairAskView } | { kind: "error"; message: string }

/** Add a computer: show the code and the commands, wait on the mailbox, then confirm what asked. */
function AddComputer({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<Adding>({ kind: "starting" })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const stop = new AbortController()
    let pairing: Pairing | null = null
    void (async () => {
      try {
        pairing = await beginPairing()
        if (stop.signal.aborted) return void pairing.cancel()
        setState({ kind: "waiting", pairing })
        const ask = await pairing.next(stop.signal)
        if (ask && !stop.signal.aborted) setState({ kind: "confirm", pairing, ask })
      } catch (err) {
        if (!stop.signal.aborted) setState({ kind: "error", message: errorText(err) })
      }
    })()
    return () => {
      stop.abort()
      void pairing?.cancel().catch(() => {})
    }
  }, [])

  if (state.kind === "starting") return <Spinner />
  if (state.kind === "error")
    return (
      <>
        <p className="text-ui leading-normal text-alert">{state.message}</p>
        <Button variant="secondary" className="mt-3" onClick={onDone}>
          Back
        </Button>
      </>
    )
  if (state.kind === "waiting") {
    const cmd = pairCommands(state.pairing.code)
    return (
      <>
        <p className="text-ui leading-normal text-ink-2">Paste this into a terminal on the computer. It installs kiwi and pairs it with this app:</p>
        <Command text={cmd.install} label="Copy the install command" />
        <p className="mt-3 text-ui leading-normal text-ink-2">Already has kiwi? Run this instead:</p>
        <Command text={cmd.pair} label="Copy the pair command" />
        <div className="mt-4 flex items-center gap-3">
          <Spinner />
          <span className="text-ui text-ink-2">Waiting for the computer…</span>
        </div>
        <Button variant="ghost" className="mt-3 -ml-3.5" onClick={onDone}>
          Cancel
        </Button>
      </>
    )
  }
  const { pairing, ask } = state
  const answer = async (accept: boolean) => {
    setBusy(true)
    try {
      const r = await pairing.answer(accept)
      if (accept && r) toast(`Paired ${ask.label}`)
      onDone()
    } catch (err) {
      setState({ kind: "error", message: errorText(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <p className="text-ui leading-normal text-ink-2">
        <span className="font-medium text-ink">{ask.label}</span> ({ask.os}) asks to pair. Pair it only if you just ran the command on it yourself: its agents will join your channels as yours.
      </p>
      <div className="mt-4 flex gap-2">
        <Button disabled={busy} onClick={() => void answer(true)}>
          {busy ? <Spinner className="border-white/30 border-t-white" /> : "Pair"}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => void answer(false)}>
          Not this one
        </Button>
      </div>
    </>
  )
}

/** Your paired computers: add one, or remove one (and its agents from your channels). */
export function ComputerRows({ adding, onAdded }: { adding: boolean; onAdded: () => void }) {
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

  if (adding) return <AddComputer onDone={onAdded} />
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
                {c.os} · paired {formatAgo(c.at, clockNow())}
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
  const [adding, setAdding] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) setAdding(false)
  }
  const inApp = !!bridge()

  return (
    <Modal open={open} onClose={onClose} closeLabel="Close Your computers">
      <div className="p-5">
        <h2 className="text-title font-semibold">Your computers</h2>
        <p className="mt-1 text-ui leading-normal text-ink-2">
          Agents on a paired computer join your channels as yours: Channels lets them in on its own while it runs. Removing a computer also takes its agents out of the channels you own.
        </p>
        <div className="mt-4 grid gap-1">
          <ComputerRows adding={adding} onAdded={() => setAdding(false)} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          {!adding && inApp && (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              Add a computer
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  )
}
