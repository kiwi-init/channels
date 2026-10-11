import { useEffect, useState } from "react"

import { machineCode } from "@mc/vouch.ts"
import { displayName, useAuth } from "@/lib/auth"
import { clockNow } from "@/lib/channel"
import { autoAdmitOn, computerInfo, confirmComputer, myComputers, removeComputer, setAutoAdmit, trustComputer, trustedComputers, untrustComputer, type Computer } from "@/lib/computers"
import { formatAgo } from "@/lib/format"
import { Button, Modal, Spinner, Wordmark, errorText, toast } from "./kit"

/**
 * The page `kiwi setup` opens: link that computer to the signed-in person, so
 * agents started there join as theirs. Only after they check the code matches.
 */
export function LinkComputerPage({ pk, onDone }: { pk: string; onDone: () => void }) {
  const auth = useAuth()
  const [code, setCode] = useState("")
  const [info, setInfo] = useState<{ label: string; status: string } | null>(null)
  const [state, setState] = useState<"loading" | "ready" | "working" | "done" | "error">("loading")
  const [error, setError] = useState("")

  useEffect(() => {
    // The code comes from the key in this link, the same way the terminal derives it.
    void machineCode(pk).then(setCode)
    computerInfo(pk)
      .then((i) => {
        setInfo(i)
        setState(i.status === "linked" ? "done" : "ready")
      })
      .catch((err: unknown) => {
        setError(errorText(err))
        setState("error")
      })
  }, [pk])

  const confirm = async () => {
    setState("working")
    try {
      const token = await auth.token()
      if (!token) throw new Error("Sign in first.")
      await confirmComputer(pk, token)
      // The person just compared this computer's code here: its agents may come in on their own.
      if (auth.user) trustComputer(auth.user.id, pk)
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
            Agents you start on <span className="font-medium text-ink">{info?.label ?? "it"}</span> will join channels as yours. Channel owners still approve each one.
          </p>
          {state === "loading" && <Spinner className="mt-6" />}
          {state === "ready" && (
            <>
              <p className="mt-6 text-ui text-ink-2">Check that your terminal shows this code:</p>
              <div className="my-5 text-[44px] leading-none font-semibold tracking-[0.04em] tabular-nums">{code}</div>
              {auth.status === "signed-in" ? (
                <div className="flex gap-2">
                  <Button size="lg" onClick={() => void confirm()}>
                    Yes, link it
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
              <p className="mt-2 text-ui text-ink-2">Agents you start there now come into channels you own without a code check, while you have one of those channels open here.</p>
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

  const user = auth.user?.id ?? null
  const [trusted, setTrusted] = useState(() => (user ? trustedComputers(user) : new Set<string>()))
  const [auto, setAuto] = useState(() => (user ? autoAdmitOn(user) : true))
  const [checking, setChecking] = useState<{ pk: string; code: string } | null>(null)
  const startTrust = async (c: Computer) => setChecking({ pk: c.pk, code: await machineCode(c.pk) })
  const trust = (pk: string, on: boolean) => {
    if (!user) return
    if (on) trustComputer(user, pk)
    else untrustComputer(user, pk)
    setTrusted(trustedComputers(user))
    setChecking(null)
  }

  const remove = async (c: Computer) => {
    try {
      const t = await auth.token()
      if (!t) throw new Error("Sign in first.")
      await removeComputer(c.pk, t)
      if (user) untrustComputer(user, c.pk)
      setList((l) => l?.filter((x) => x.pk !== c.pk) ?? null)
      toast(`Removed ${c.label}`)
    } catch (err) {
      toast(errorText(err), "error")
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="p-5">
        <h2 className="text-title font-semibold">Your computers</h2>
        <p className="mt-1 text-ui leading-normal text-ink-2">
          Agents started on these join channels as yours. A computer unused for 30 days is unlinked on its own. Remove one you no longer use or trust.
        </p>
        <div className="mt-4 grid gap-1">
          {list === null && <Spinner />}
          {list?.length === 0 && <p className="text-ui text-ink-3">None yet. Run kiwi setup on a computer to link it.</p>}
          {list?.map((c) => (
            <div key={c.pk} className="rounded-ctl py-1.5">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui font-medium">{c.label}</p>
                  <p className="text-meta text-ink-3">
                    {usage(c, clockNow())}
                    {trusted.has(c.pk) ? " · its agents come in on their own" : ""}
                  </p>
                </div>
                {trusted.has(c.pk) ? (
                  <Button size="sm" variant="secondary" onClick={() => trust(c.pk, false)}>
                    Ask each time
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => void startTrust(c)}>
                    Trust…
                  </Button>
                )}
                <Button size="sm" variant="danger" onClick={() => void remove(c)}>
                  Remove
                </Button>
              </div>
              {checking?.pk === c.pk && (
                <div className="mt-2 rounded-ctl bg-wash p-3">
                  <p className="text-ui leading-normal text-ink-2">
                    On {c.label}, run <code className="font-mono text-meta">kiwi setup status</code>. Trust it only if it shows:
                  </p>
                  <p className="my-2 text-display leading-none font-semibold tracking-[0.04em] tabular-nums">{checking.code}</p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => trust(c.pk, true)}>
                      It matches
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setChecking(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {user && (
          <label className="mt-4 flex items-start gap-2 text-ui leading-normal">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                setAutoAdmit(user, e.target.checked)
                setAuto(e.target.checked)
              }}
              className="mt-0.5 size-4 accent-[var(--accent)]"
            />
            <span>
              Let agents from trusted computers into channels I own without a code check
              <span className="block text-meta text-ink-3">Their computer’s signature stands in for the code; the relay can’t forge it. It happens while one of those channels is open in this browser.</span>
            </span>
          </label>
        )}
        <div className="mt-5 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  )
}
