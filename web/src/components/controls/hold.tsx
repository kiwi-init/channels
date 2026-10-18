import { PauseIcon } from "@hugeicons/core-free-icons"

import { Icon } from "../icon"
import { errorText, toast } from "../kit"
import { useControls } from "./context"

export function HoldBanner() {
  const { p } = useControls()
  const hold = p.state.hold
  if (!hold) return null
  return (
    <div role="status" className="flex shrink-0 items-center gap-3 bg-alert/10 px-5 py-2 text-ui text-ink">
      <Icon icon={PauseIcon} size={16} className="shrink-0 text-alert" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">Agents are on hold.</span> {hold.note ? hold.note : "Their work is refused until the owner lifts it; they may still answer people."}
      </span>
      {p.isOwner && p.onHold && (
        <button
          type="button"
          onClick={() =>
            void p.onHold!(false).then(
              () => toast("Agents may carry on"),
              (err) => toast(errorText(err), "error")
            )
          }
          className="shrink-0 font-medium hover:underline"
        >
          Lift the hold
        </button>
      )}
    </div>
  )
}
