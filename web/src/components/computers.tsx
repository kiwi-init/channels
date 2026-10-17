import { useEffect, useState } from "react"

import { clockNow } from "@/lib/channel"
import { adoptThisComputer, beginPairing, pairCommands, removeComputer, type ComputerView, type PairAskView, type Pairing } from "@/lib/computers"
import { formatAgo } from "@/lib/format"
import { digitsLine } from "@/lib/link-digits"
import { beginLinking, type LinkAskView, type Linking } from "@/lib/phones"
import { bridge, useSecrets } from "@/lib/secrets"
import { Command } from "./add-agent"
import { Button, Modal, Spinner, errorText, toast } from "./kit"
import { QrCode } from "./qr"

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

type Linkage = { kind: "starting" } | { kind: "waiting"; linking: Linking } | { kind: "confirm"; linking: Linking; ask: LinkAskView } | { kind: "error"; message: string }

/** Link a phone: show a code to scan, wait for the phone, compare six digits with it, then send the person to it. */
function LinkPhone({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<Linkage>({ kind: "starting" })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const stop = new AbortController()
    let linking: Linking | null = null
    void (async () => {
      try {
        linking = await beginLinking()
        if (stop.signal.aborted) return void linking.cancel()
        setState({ kind: "waiting", linking })
        const ask = await linking.next(stop.signal)
        if (ask && !stop.signal.aborted) setState({ kind: "confirm", linking, ask })
      } catch (err) {
        if (!stop.signal.aborted) setState({ kind: "error", message: errorText(err) })
      }
    })()
    return () => {
      stop.abort()
      void linking?.cancel().catch(() => {})
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
    return (
      <>
        <p className="text-ui leading-normal text-ink-2">On your phone, open Kiwi, choose Link this phone and scan this. No camera? Copy the code and paste it there.</p>
        <div className="mt-3 flex justify-center">
          <QrCode text={state.linking.code} label="Code to link a phone" />
        </div>
        <Command text={state.linking.code} label="Copy the code" />
        <div className="mt-4 flex items-center gap-3">
          <Spinner />
          <span className="text-ui text-ink-2">Waiting for your phone…</span>
        </div>
        <Button variant="ghost" className="mt-3 -ml-3.5" onClick={onDone}>
          Cancel
        </Button>
      </>
    )
  }
  const { linking, ask } = state
  const answer = async (accept: boolean) => {
    setBusy(true)
    try {
      const r = await linking.answer(accept)
      if (accept && r) toast(`Linked ${r.label}`)
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
        <span className="font-medium text-ink">{ask.label}</span> asks to link. Your phone should show the same six numbers:
      </p>
      <p aria-label={`Check numbers ${ask.digits.split("").join(" ")}`} className="my-4 text-[44px] leading-none font-semibold tracking-[0.04em] tabular-nums">
        {digitsLine(ask.digits)}
      </p>
      <p className="text-meta leading-normal text-ink-3">
        Linking gives that phone your Kiwi person and the key of every channel you hold. Link only a phone you hold yourself, and only if the numbers match.
      </p>
      <div className="mt-4 flex gap-2">
        <Button disabled={busy} onClick={() => void answer(true)}>
          {busy ? <Spinner className="border-white/30 border-t-white" /> : "It matches: link"}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => void answer(false)}>
          Not this one
        </Button>
      </div>
    </>
  )
}

/** Your paired computers: add one, or remove one (and its agents from your channels). */
export function ComputersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { computers, phones } = useSecrets()
  const [adding, setAdding] = useState(false)
  const [linking, setLinking] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) {
      setAdding(false)
      setLinking(false)
    }
  }

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
    <Modal open={open} onClose={onClose}>
      <div className="p-5">
        <h2 className="text-title font-semibold">Your computers</h2>
        <p className="mt-1 text-ui leading-normal text-ink-2">
          Agents on a paired computer join your channels as yours: Kiwi lets them in on its own while it runs. Removing a computer also takes its agents out of the channels you own.
        </p>
        <div className="mt-4 grid gap-1">
          {linking ? (
            <LinkPhone onDone={() => setLinking(false)} />
          ) : adding ? (
            <AddComputer onDone={() => setAdding(false)} />
          ) : (
            <>
              {/* In the app, this computer belongs on the list: if adding it at start didn't work, say so and offer it. */}
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
                <div key={c.machinePk} className="flex items-center gap-3 rounded-ctl py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ui font-medium">
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
              ))}
              {phones.length > 0 && (
                <>
                  <p className="mt-3 text-meta font-medium text-ink-3">Linked phones</p>
                  {phones.map((p) => (
                    <div key={`${p.label}-${p.at}`} className="rounded-ctl py-1.5">
                      <p className="truncate text-ui font-medium">{p.label}</p>
                      <p className="text-meta text-ink-3">Linked {formatAgo(p.at, clockNow())}. It holds your person and channel keys.</p>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          {!adding && !linking && inApp && (
            <Button variant="secondary" onClick={() => setLinking(true)}>
              Link a phone
            </Button>
          )}
          {!adding && !linking && inApp && (
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
