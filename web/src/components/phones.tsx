import { useEffect, useState } from "react"

import { clockNow } from "@/lib/channel"
import { formatAgo } from "@/lib/format"
import { digitsLine } from "@/lib/link-digits"
import { beginLinking, type LinkAskView, type Linking } from "@/lib/phones"
import { useSecrets } from "@/lib/secrets"
import { Command } from "./add-agent"
import { Button, Spinner, errorText, toast } from "./kit"
import { QrCode } from "./qr"

type Linkage = { kind: "starting" } | { kind: "waiting"; linking: Linking } | { kind: "confirm"; linking: Linking; ask: LinkAskView } | { kind: "error"; message: string }

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
        <Button variant="secondary" className="mt-3 w-fit" onClick={onDone}>
          Back
        </Button>
      </>
    )
  if (state.kind === "waiting") {
    return (
      <>
        <p className="text-ui leading-normal text-ink-2">On your iPhone, open Channels and choose Scan the code. No camera? Copy the code and choose Paste the code there.</p>
        <div className="mt-3 flex justify-center">
          <QrCode text={state.linking.code} label="Code to link a phone" />
        </div>
        <Command text={state.linking.code} label="Copy the code" />
        <div className="mt-4 flex items-center gap-3">
          <Spinner />
          <span className="text-ui text-ink-2">Waiting for your phone…</span>
        </div>
        <Button variant="ghost" className="mt-3 -ml-3.5 w-fit" onClick={onDone}>
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
        <span className="font-medium text-ink">{ask.label}</span> asks to link. Your phone shows six numbers too:
      </p>
      <p aria-label={`Check numbers ${ask.digits.split("").join(" ")}`} className="my-4 text-display font-semibold tabular-nums">
        {digitsLine(ask.digits)}
      </p>
      <p className="text-meta leading-normal text-ink-3">
        Linking gives that phone your person and the key of every channel you hold. Link only a phone you hold yourself, and only if the numbers match.
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

export function PhoneRows({ linking, onLinked }: { linking: boolean; onLinked: () => void }) {
  const { phones } = useSecrets()
  if (linking) return <LinkPhone onDone={onLinked} />
  if (!phones.length) return <p className="text-ui text-ink-3">None yet. Install Channels on your iPhone, then link it here.</p>
  return (
    <>
      {phones.map((p) => (
        <div key={`${p.label}-${p.at}`} className="rounded-ctl py-1.5">
          <p className="truncate text-ui font-medium">{p.label}</p>
          <p className="text-meta text-ink-3">Linked {formatAgo(p.at, clockNow())}. It holds your person and channel keys.</p>
        </div>
      ))}
    </>
  )
}
