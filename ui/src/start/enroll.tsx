import "~/i18n/en/shell-later"
import "~/styles/start.css"

import type { Enrolling } from "~/model"
import { useActions } from "~/nav"
import { t } from "~/i18n/i18n"
import { clearNoMatch, sawNoMatch } from "~/start/no-match"

function Asking() {
  return (
    <>
      <h1 className="start-word">{t("start.enroll.open.other")}</h1>
      <p className="start-asking" aria-live="polite">
        <span className="start-pip" aria-hidden="true" />
        {t("start.enroll.approve.there")}
      </p>
    </>
  )
}

function Digits({ digits }: { digits: string }) {
  return (
    <>
      <h1 className="start-word">{t("start.enroll.type.these")}</h1>
      <p className="start-digits" aria-live="polite" aria-label={digits.split("").join(" ")}>
        {digits.slice(0, 3)}
        <span aria-hidden="true"> </span>
        {digits.slice(3)}
      </p>
    </>
  )
}

function Check({ person }: { person: { name: string; fingerprint: string } }) {
  const actions = useActions()
  return (
    <>
      <h1 className="start-word">{t("start.enroll.your.key", { name: person.name })}</h1>
      <p className="start-key" aria-live="polite">
        {person.fingerprint}
      </p>
      <p className="start-hint">{t("start.enroll.compare")}</p>
      <div className="start-row start-check">
        <button
          type="button"
          className="btn is-quiet"
          onClick={() => {
            sawNoMatch(person.fingerprint)
            actions.enrollCancel()
          }}
        >
          {t("start.enroll.no.match")}
        </button>
        <button type="button" className="btn is-primary" autoFocus onClick={() => actions.enrollKeep()}>
          {t("start.enroll.matches")}
        </button>
      </div>
    </>
  )
}

export function NoMatch({ fingerprint }: { fingerprint: string }) {
  const actions = useActions()
  return (
    <div className="start-first-box">
      <span className="start-mark">
        <img src="/icon.svg" width={40} height={40} alt="" />
      </span>
      <h1 className="start-word">{t("start.enroll.missed.title")}</h1>
      <p className="start-lede">{t("start.enroll.missed.sub")}</p>
      <p className="start-hint">{t("start.enroll.missed.devices", { fingerprint })}</p>
      <div className="start-row start-check">
        <button type="button" className="btn is-quiet" onClick={clearNoMatch}>
          {t("start.enroll.missed.back")}
        </button>
        <button
          type="button"
          className="btn is-primary"
          autoFocus
          onClick={() => {
            clearNoMatch()
            actions.enrollBegin()
          }}
        >
          {t("start.enroll.missed.again")}
        </button>
      </div>
    </div>
  )
}

export default function Enroll({ enrolling }: { enrolling: Extract<Enrolling, { stage: "asking" | "digits" | "check" }> }) {
  const actions = useActions()
  return (
    <div className="start-first-box">
      <span className="start-mark">
        <img src="/icon.svg" width={40} height={40} alt="" />
      </span>
      {enrolling.stage === "asking" && <Asking />}
      {enrolling.stage === "digits" && <Digits digits={enrolling.digits} />}
      {enrolling.stage === "check" && <Check person={enrolling.person} />}
      {enrolling.stage !== "check" && (
        <div className="start-others">
          <button type="button" className="btn is-quiet" onClick={() => actions.enrollCancel()}>
            {t("start.enroll.cancel")}
          </button>
        </div>
      )}
    </div>
  )
}
