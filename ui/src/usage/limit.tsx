import { Modal } from "~/kit/modal"
import { openOutside } from "~/kit/outside"
import { useApp } from "~/nav"
import { UsageBar } from "~/usage/meter"
import { closeLimit, useUsage, type LimitHit } from "~/usage/store"
import { canUpgrade, count, resetsIn, upgradeLabel } from "~/usage/words"

export function LimitDialog({ hit }: { hit: LimitHit }) {
  const { app } = useApp()
  const usage = useUsage(app.actions.myUsage)
  const channel = hit.code !== null && app.channel?.code === hit.code ? app.channel : null
  const owner = channel?.people.find((p) => p.owner) ?? null
  const full = usage !== null && usage.limit !== null && usage.used >= usage.limit
  const mine = hit.code === null || owner?.you === true || (owner === null && full)
  const later = usage ? resetsIn(usage.resetsAt, usage.checkedAt) : null
  const again = later ? `Messages send again in ${later}, at 00:00 UTC.` : "Messages send again at 00:00 UTC."
  if (!mine) {
    const who = owner ? (owner.display ?? owner.name) : "This channel's owner"
    return (
      <Modal
        dismiss="outside"
        label="This channel is out of messages today"
        title="This channel is out of messages today"
        sub={`${who} has used today's messages, so nobody can send here for now. ${again}`}
        onClose={closeLimit}
        size="narrow"
        foot={
          <button type="button" className="btn is-primary" autoFocus onClick={closeLimit}>
            OK
          </button>
        }
      />
    )
  }
  const upgrade = usage && canUpgrade(usage) ? usage.upgradeUrl : null
  const limit = usage?.limit ?? null
  return (
    <Modal
      dismiss="outside"
      label="Today's messages are used up"
      title="Today's messages are used up"
      sub={
        limit === null
          ? `Your channels have used today's messages. ${again}`
          : `Your channels sent ${count(limit)} messages today, agents' included: ${usage?.plan === "paid" ? "the paid plan's" : "the free plan's"} daily limit. ${again}`
      }
      onClose={closeLimit}
      size="narrow"
      foot={
        upgrade && usage ? (
          <>
            <button type="button" className="btn is-quiet" onClick={closeLimit}>
              Not now
            </button>
            <button
              type="button"
              className="btn is-primary"
              autoFocus
              onClick={() => {
                openOutside(upgrade)
                closeLimit()
              }}
            >
              {upgradeLabel(usage)}
            </button>
          </>
        ) : (
          <button type="button" className="btn is-primary" autoFocus onClick={closeLimit}>
            OK
          </button>
        )
      }
    >
      {usage && usage.limit !== null && (
        <div className="usage-limit">
          <UsageBar usage={usage} />
          {upgrade && usage.paidLimit ? <p className="usage-limit-hint">The paid plan sends {count(usage.paidLimit)} messages a day.</p> : null}
        </div>
      )}
    </Modal>
  )
}
