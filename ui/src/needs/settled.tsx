import { useState } from "react"

import { oneLine } from "~/chat/earlier"
import { t } from "~/i18n/i18n"
import type { Channel, Settled } from "~/model"
import { nickname } from "~/names"
import { useAct } from "~/nav"
import { clock } from "~/kit/time"

function Row({ channel, item }: { channel: Channel; item: Settled }) {
  const { actions } = useAct()
  const [text, setText] = useState<string | null>(null)
  return (
    <li className="settled-row">
      <p className="settled-question">{oneLine(item.question, channel.nicknames)}</p>
      <p className="settled-answer">
        {t("needs.settled.row", { asker: nickname(channel, item.asker), lead: nickname(channel, item.by), answer: oneLine(item.answer, channel.nicknames) })} · <time>{clock(item.at)}</time>
      </p>
      {item.overruled ? (
        <p className="settled-answer is-overruled">{t("needs.settled.overruled", { text: oneLine(item.overruled.text, channel.nicknames) })}</p>
      ) : text === null ? (
        <button type="button" className="btn is-quiet is-small" onClick={() => setText("")}>
          {t("needs.settled.overrule")}
        </button>
      ) : (
        <form
          className="ask-other"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) actions.overrule(channel.code, item.id, text.trim())
          }}
        >
          <input
            autoFocus
            className="input"
            value={text}
            aria-label={t("needs.settled.placeholder", { asker: nickname(channel, item.asker) })}
            placeholder={t("needs.settled.placeholder", { asker: nickname(channel, item.asker) })}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setText(null)}
          />
          <button type="submit" className="btn is-primary is-small" disabled={!text.trim()}>
            {t("needs.settled.overrule")}
          </button>
        </form>
      )}
    </li>
  )
}

export default function SettledList({ channel, settled }: { channel: Channel; settled: readonly Settled[] }) {
  return (
    <ul className="settled">
      {settled.map((item) => (
        <Row key={item.id} channel={channel} item={item} />
      ))}
    </ul>
  )
}
