import { Download04Icon } from "@hugeicons/core-free-icons"

import { openRelease, restartToUpdate, type UpdateView } from "@kiwi/app/update.ts"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"
import { Tooltip } from "./ui/tooltip"

const words = (u: UpdateView) =>
  u.state === "downloading" ? `Downloading Channels ${u.version}…` : u.state === "ready" ? `Restart to update to ${u.version}` : `Channels ${u.version} is out · Get it`

const act = (u: UpdateView) => (u.state === "ready" ? restartToUpdate() : openRelease(u))

export function UpdatePill({ update }: { update: UpdateView }) {
  return (
    <button
      type="button"
      disabled={update.state === "downloading"}
      onClick={() => act(update)}
      className={cx("glass flex h-9 items-center gap-2 rounded-full pr-4 pl-3 text-ui font-medium", update.state === "ready" ? "text-accent-text" : "text-ink-2")}
    >
      <Icon icon={Download04Icon} size={16} className="shrink-0" />
      {words(update)}
    </button>
  )
}

export function UpdateButton({ update, className }: { update: UpdateView; className: string }) {
  return (
    <Tooltip label={words(update)}>
      <button
        type="button"
        aria-label={update.state === "ready" ? `Restart to update to ${update.version}` : `Channels ${update.version} is out`}
        disabled={update.state === "downloading"}
        onClick={() => act(update)}
        className={cx(className, "relative", update.state === "ready" && "text-accent-text")}
      >
        <Icon icon={Download04Icon} size={18} />
        <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-accent" />
      </button>
    </Tooltip>
  )
}
