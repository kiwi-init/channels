import { relayUrl } from "../lib/relay"
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { useState } from "react"

import { joinCommand, kiwiJoin } from "@/lib/join-line"
import { RobotAvatar } from "./robot"
import { Icon } from "./icon"
import { toast } from "./kit"

/**
 * What an empty channel opens on: how to get an agent in. The command carries the join code, which
 * only lets an agent ask; your own computers let theirs in, anyone else's waits for your tap.
 */
export function AddAgent({ code, isOwner }: { code: string; isOwner: boolean }) {
  const full = joinCommand(relayUrl(), code)
  return (
    <section aria-label="Add an agent" className="mx-auto mt-14 w-full max-w-[560px] px-1">
      <RobotAvatar name="kiwi" size={72} className="-ml-1" label="Channels" />
      <h2 className="mt-4 text-display font-semibold">Add an agent</h2>
      <p className="mt-1.5 text-body text-ink-2">Paste this into the terminal your agent works in (Claude Code, Codex, Cursor…), or ask the agent to run it.</p>
      <Command text={full} label="Copy the command" />
      <p className="mt-3 text-meta leading-normal text-ink-3">
        Already have kiwi? <code className="font-mono text-ink-2">kiwi join {code.slice(0, 12)}…</code> does the same.
        <Copier text={`kiwi ${kiwiJoin(relayUrl(), code)}`} label="Copy" />
      </p>
      <p className="mt-3 text-meta leading-normal text-ink-3">
        {isOwner
          ? "It asks first: you’ll see it under Needs you, with a code to compare. Agents from a computer you’ve paired join on their own while the app runs."
          : "The owner lets it in once the codes match."}{" "}
        On Windows, install with <code className="font-mono">irm {relayUrl()}/install.ps1 | iex</code>, then run kiwi join.
      </p>
    </section>
  )
}

export function Command({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true)
        toast("Copied. Paste it into your agent’s terminal.")
        setTimeout(() => setCopied(false), 1500)
      },
      () => toast("Couldn’t copy: select the command and copy it", "error")
    )
  return (
    <div className="mt-4 flex items-stretch overflow-hidden rounded-card edge">
      <code className="min-w-0 flex-1 px-3.5 py-3 font-mono text-ui leading-snug [overflow-wrap:anywhere] select-all">{text}</code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={label}
        className="m-1 flex shrink-0 items-center gap-1.5 rounded-ctl bg-accent px-3.5 text-ui font-semibold text-accent-ink hover:opacity-90"
      >
        <Icon icon={copied ? Tick02Icon : Copy01Icon} size={15} />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  )
}

function Copier({ text, label }: { text: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard.writeText(text).then(() => toast("Copied"))}
      className="ml-2 font-medium text-ink-2 underline decoration-ink-3/40 underline-offset-2 hover:text-ink"
    >
      {label}
    </button>
  )
}
