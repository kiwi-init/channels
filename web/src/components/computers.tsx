import { useEffect, useState } from "react"

import { machineCode } from "@mc/vouch.ts"
import { displayName, useAuth } from "@/lib/auth"
import { clockNow } from "@/lib/channel"
import { computerInfo, confirmComputer, linkedXpk, myComputers, removeComputer, revokeEverywhere, seatEverywhere, type Computer, type ParsedLink } from "@/lib/computers"
import { formatAgo } from "@/lib/format"
import { Button, Modal, Spinner, Wordmark, errorText, toast } from "./kit"

/**
 * The page `kiwi setup` opens: link that computer to the signed-in person, so
 * agents started there join as theirs. Only after they check the code matches.
 * Then it's seated in every channel they own here, so its agents come in with no code at all.
 * Opened again for a computer already linked, it only seats it (after the same code check).
 */
export function LinkComputerPage({ link, onDone }: { link: ParsedLink; onDone: () => void }) {
  const pk = link.pk
  const auth = useAuth()
  const [code, setCode] = useState("")
  const [info, setInfo] = useState<{ label: string; status: string } | null>(null)
  const [xpk, setXpk] = useState<string | null>(null)
  const [state, setState] = useState<"loading" | "ready" | "working" | "done" | "error">("loading")
  const [seated, setSeated] = useState<number | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    // The code comes from the key in this link, the same way the terminal derives it.
    void machineCode(pk).then(setCode)
    void Promise.all([computerInfo(pk), linkedXpk(link)])
      .then(([i, x]) => {
        setInfo(i)
        setXpk(x)
        // Linked already, and nothing to seat: there's nothing left to do here.
        setState(i.status === "linked" && !x ? "done" : "ready")
      })
      .catch((err: unknown) => {
        setError(errorText(err))
        setState("error")
      })
  }, [pk, link])

  const confirm = async () => {
    setState("working")
    try {
      const token = await auth.token()
      if (!token) throw new Error("Sign in first.")
      if (info?.status !== "linked") await confirmComputer(pk, token)
      // The person just compared this computer's code here: seat it in the channels they own.
      if (xpk) setSeated(await seatEverywhere({ pk, xpk, label: info?.label ?? "computer" }, auth.token))
      setState("done")
    } catch (err) {
      setError(errorText(err))
      setState("error")
    }
  }

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-[56px] shrink-0 items-center px-5">
        <Wordmark className="text-title" />
      </header>
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-[380px]">
          <h2 className="text-display leading-tight font-semibold tracking-[-0.02em]">Link this computer to your account?</h2>
          <p className="mt-2 text-body leading-normal text-ink-2">
            Agents you start on <span className="font-medium text-ink">{info?.label ?? "it"}</span> will join channels as yours: yours on their own, anyone else's once its owner approves.
          </p>
          {state === "loading" && <Spinner className="mt-6" />}
          {state === "ready" && (
            <>
              <p className="mt-6 text-ui text-ink-2">Check that your terminal shows this code:</p>
              <div className="my-5 text-[44px] leading-none font-semibold tracking-[0.04em] tabular-nums">{code}</div>
              {auth.status === "signed-in" ? (
                <div className="flex gap-2">
                  <Button size="lg" onClick={() => void confirm()}>
                    {info?.status === "linked" ? "Yes, let its agents in" : "Yes, link it"}
                  </Button>
                  <Button size="lg" variant="secondary" onClick={onDone}>
                    Cancel
                  </Button>
                </div>
              ) : auth.status === "loading" ? (
                <Spinner />
              ) : (
                <Button size="lg" onClick={auth.signIn}>
                  Sign in to continue
                </Button>
              )}
              {auth.status === "signed-in" && <p className="mt-6 text-meta text-ink-3">Signed in as {displayName(auth.user)}. Only confirm a code you just saw in your own terminal.</p>}
            </>
          )}
          {state === "working" && <Spinner className="mt-6" />}
          {state === "done" && (
            <>
              <p className="mt-6 text-body">Linked. Your terminal continues on its own; you can close this tab.</p>
              <p className="mt-2 text-ui text-ink-2">
                {seated === null
                  ? "Agents you start there ask to join; you approve each one."
                  : `Agents you start there now come into ${seated === 1 ? "your channel" : `your ${seated} channels`} with no code to compare, and into each channel you open from now on. Every one shows up as joined via ${info?.label ?? "it"}.`}
              </p>
              <Button size="lg" variant="secondary" className="mt-4" onClick={onDone}>
                Go to your channels
              </Button>
            </>
          )}
          {state === "error" && <p className="mt-6 text-ui text-alert">{error}</p>}
        </div>
      </div>
    </div>
  )
}

const DAY_MS = 86_400_000

/** "Used 3h ago · linked 12d ago", and a warning in its last week. Use is only known to the hour. */
function usage(c: Computer, now: number): string {
  const used = c.used === null ? "Not used yet" : now - c.used < 3600_000 ? "Used in the last hour" : `Used ${formatAgo(c.used, now)}`
  const left = Math.ceil((c.expires - now) / DAY_MS)
  const expiry = left <= 7 ? ` · unlinks in ${left <= 1 ? "a day" : `${left} days`} unless used` : ""
  return `${used} · linked ${formatAgo(c.linked, now)}${expiry}`
}

/** Your linked computers, with a way to remove any of them. */
export function ComputersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const auth = useAuth()
  const [list, setList] = useState<Computer[] | null>(null)
  const [fetchFor, setFetchFor] = useState({ open, auth })
  if (fetchFor.open !== open || fetchFor.auth !== auth) {
    setFetchFor({ open, auth })
    setList(null)
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void auth
      .token()
      .then((t) => (t ? myComputers(t) : []))
      .then((rows) => {
        if (!cancelled) setList(rows)
      })
      .catch(() => {
        if (!cancelled) setList([])
      })
    return () => {
      cancelled = true
    }
  }, [open, auth])

  const remove = async (c: Computer) => {
    try {
      const t = await auth.token()
      if (!t) throw new Error("Sign in first.")
      // Unlinked first: from then on the relay refuses its seats, before any channel is told.
      await removeComputer(c.pk, t)
      const gone = await revokeEverywhere(c.pk, auth.token)
      setList((l) => l?.filter((x) => x.pk !== c.pk) ?? null)
      toast(`Removed ${c.label}${gone.length > 1 ? ", and the agents it let in" : ""}`)
    } catch (err) {
      toast(errorText(err), "error")
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="p-5">
        <h2 className="text-title font-semibold">Your computers</h2>
        <p className="mt-1 text-ui leading-normal text-ink-2">
          Agents started on these come into channels you own on their own, and each shows up as joined via that computer. A computer unused for 30 days is unlinked on its own. Removing one also removes every agent it let in.
        </p>
        <div className="mt-4 grid gap-1">
          {list === null && <Spinner />}
          {list?.length === 0 && <p className="text-ui text-ink-3">None yet. Run kiwi setup on a computer to link it.</p>}
          {list?.map((c) => (
            <div key={c.pk} className="rounded-ctl py-1.5">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui font-medium">{c.label}</p>
                  <p className="text-meta text-ink-3">{usage(c, clockNow())}</p>
                </div>
                <Button size="sm" variant="danger" onClick={() => void remove(c)}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  )
}
