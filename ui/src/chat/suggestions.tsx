import type { Suggest } from "~/chat/suggest"
import { t } from "~/i18n/i18n"
import { Avatar, cx, Dot, STATUS_WORDS } from "~/kit/bits"
import type { Channel } from "~/model"
import { nickname, roleWord, shown, Shown } from "~/names"

export function Suggestions({ channel, s }: { channel: Channel; s: Suggest }) {
  if (s.tasks.length + s.specs.length)
    return (
      <ul className="mentions" role="listbox" aria-label={t("chat.suggest.tasks")} id={`${s.id}-tasks`}>
        {s.tasks.map((t, i) => (
          <li key={t.id} role="option" aria-selected={i === s.pick}>
            <button type="button" tabIndex={-1} className={cx("mention-row task-row", i === s.pick && "is-on")} onMouseDown={(e) => e.preventDefault()} onClick={() => s.completeTask(t.id)}>
              <Dot status={t.status} />
              <span className="task-row-id">T{t.id}</span>
              <span className="task-row-title">
                <Shown value={t.title} />
              </span>
              <span className="dim">{t.owner ? nickname(channel, t.owner) : STATUS_WORDS[t.status]}</span>
            </button>
          </li>
        ))}
        {s.specs.map((sp, i) => (
          <li key={`spec-${sp.ask}`} role="option" aria-selected={s.tasks.length + i === s.pick}>
            <button
              type="button"
              tabIndex={-1}
              className={cx("mention-row task-row", s.tasks.length + i === s.pick && "is-on")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => s.completeSpec(sp.ask)}
            >
              <span className="task-row-id">#{sp.ask}</span>
              <span className="task-row-title">
                <Shown value={sp.title} />
              </span>
              <span className="dim">{t("chat.suggest.spec")}</span>
            </button>
          </li>
        ))}
      </ul>
    )
  if (!s.people.length) return null
  return (
    <ul className="mentions" role="listbox" aria-label={t("chat.suggest.people")} id={`${s.id}-people`}>
      {s.people.map((p, i) => (
        <li key={p.name} role="option" aria-selected={i === s.pick}>
          <button type="button" tabIndex={-1} className={cx("mention-row", i === s.pick && "is-on")} onMouseDown={(e) => e.preventDefault()} onClick={() => s.complete(p.name)}>
            <Avatar person={p} size="sm" pip />
            <span className="mention-name">{shown(p)}</span>
            <span className="dim">{(p.role && roleWord(p.role)) ?? p.runs ?? (p.kind === "human" ? t("chat.suggest.person") : t("chat.suggest.agent"))}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
