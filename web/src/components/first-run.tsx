import { useState } from "react"

import { createPerson } from "@/lib/secrets"
import { RobotAvatar } from "./robot"
import { Button, Spinner, TextField, errorText } from "./kit"

/**
 * First run: your name, and the person key made under it. The key stays in the app (the bridge's
 * secrets store); it says which computers are yours and who you are when you join a channel.
 */
export function FirstRun() {
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = name.trim().length > 0 && name.trim().length <= 80

  return (
    <div className="flex h-svh items-center justify-center overflow-y-auto bg-canvas p-8">
      <form
        className="w-full max-w-[380px]"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!ok) return
          setBusy(true)
          setError(null)
          try {
            await createPerson(name.trim())
          } catch (err) {
            setError(errorText(err))
            setBusy(false)
          }
        }}
      >
        <RobotAvatar name="kiwi" size={72} className="-ml-1" label="Channels" />
        <h1 className="mt-4 text-display leading-tight font-semibold tracking-[-0.02em]">What’s your name?</h1>
        <p className="mt-2 text-body leading-normal text-ink-2">
          It’s how owners see you when you join a channel, and on the computers you pair. Channels makes your key on this computer; it never leaves it.
        </p>
        <TextField className="mt-6" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" maxLength={80} autoComplete="name" aria-label="Your name" />
        {error && <p className="mt-3 text-ui text-alert">{error}</p>}
        <Button size="lg" type="submit" className="mt-5" disabled={!ok || busy}>
          {busy ? <Spinner className="border-white/30 border-t-white" /> : "Continue"}
        </Button>
      </form>
    </div>
  )
}
