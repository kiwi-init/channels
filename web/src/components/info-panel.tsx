import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  BookOpen01Icon,
  Delete02Icon,
  GithubIcon,
  GitPullRequestIcon,
  Mic01Icon,
  Note01Icon,
  PauseIcon,
  PencilEdit01Icon,
  PlayIcon,
  Robot01Icon,
  Settings02Icon,
  UserAdd01Icon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons"
import { useState, type ReactNode } from "react"

import type { ChannelIcon, RobotFace } from "@kiwi/core/protocol.ts"
import { presetOf, SCOPES } from "@kiwi/core/scopes.ts"
import { colorOf } from "@kiwi/core/state.ts"
import { memberLoad } from "@kiwi/core/load.ts"
import { memberName } from "@/lib/format"
import { cx } from "@/lib/utils"
import { ChannelIconTile, RobotPicker } from "./channel-icon"
import { useControls } from "./controls"
import { loadDetail, MemberActions, memberDetail } from "./controls/member-actions"
import { Repos } from "./controls/repos"
import { Icon, type IconSvgElement } from "./icon"
import { Button, IconButton, Monogram, SEGMENTED, SEGMENT_OFF, SEGMENT_ON, errorText, toast } from "./kit"
import { Invite } from "./lazy"
import { defaultScopes, saveDefaultScopes } from "./scopes"

export function InfoPanel({
  title,
  icon,
  subtitle,
  onClose,
  onPause,
  notes,
  hasNotes,
  onMessage,
  onJoins,
  onNewAgent,
}: {
  title: string
  icon: ChannelIcon | null
  subtitle: string
  onClose: () => void
  onPause?: () => void
  notes?: ReactNode
  hasNotes?: boolean
  onMessage?: (name: string) => void
  onJoins?: () => void
  onNewAgent?: (() => void) | undefined
}) {
  const { p, ask, openDialog } = useControls()
  const [view, setView] = useState<"details" | "invite" | "repos">("details")
  const [picking, setPicking] = useState(false)
  const [savingIcon, setSavingIcon] = useState(false)
  const [readOnly, setReadOnly] = useState(() => (p.roomId ? presetOf(defaultScopes(p.roomId)) === "read-only" : false))
  const pickIcon = (robot: RobotFace) => {
    if (!p.onIcon) return
    setSavingIcon(true)
    void p
      .onIcon({ kind: "robot", robot })
      .then(
        () => {
          setPicking(false)
          toast("Icon changed")
        },
        (err) => toast(errorText(err), "error")
      )
      .finally(() => setSavingIcon(false))
  }
  const newMembers = (only: boolean) => {
    setReadOnly(only)
    if (p.roomId) saveDefaultScopes(p.roomId, only ? [] : [...SCOPES])
  }
  const active = p.roster
    .filter((m) => m.active)
    .sort((a, b) => Number(b.owner) - Number(a.owner) || Number(a.kind !== "human") - Number(b.kind !== "human") || Number(p.online.has(b.name)) - Number(p.online.has(a.name)))
  const former = p.roster.filter((m) => !m.active)
  const hold = p.state.hold
  const lead = p.state.lead
  const back = view === "details" ? onClose : () => setView("details")

  return (
    <aside aria-label="Details" className="flex min-w-0 flex-1 flex-col bg-canvas md:sheet" onKeyDown={(e) => e.key === "Escape" && back()}>
      <header className="drag flex h-(--chrome-h) shrink-0 items-center gap-2 px-3">
        <IconButton label={view === "details" ? "Close details" : "Back to details"} round className="glass size-9 text-ink" onClick={back}>
          <Icon icon={ArrowLeft01Icon} size={18} />
        </IconButton>
        <span className="truncate text-ui font-semibold">{view === "details" ? title : "Channel settings"}</span>
      </header>

      {view !== "details" ? (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[560px]">{view === "invite" ? <Invite /> : <Repos repos={p.state.repos} onSave={p.isOwner ? p.onRepos : undefined} />}</div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pb-8 md:px-9">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-1 pb-5">
            {p.onIcon ? (
              <button type="button" aria-label="Change the channel's icon" aria-expanded={picking} onClick={() => setPicking((v) => !v)} className="rounded-full transition-opacity hover:opacity-80">
                <ChannelIconTile icon={icon} title={title} size={64} />
              </button>
            ) : (
              <ChannelIconTile icon={icon} title={title} size={64} />
            )}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-display font-semibold">{title}</h2>
              <p className="text-ui text-ink-3">
                {subtitle}
                {p.isOwner ? " · you own it" : ""}
              </p>
            </div>
            {p.isOwner && (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setView("invite")}>
                  <Icon icon={UserAdd01Icon} size={16} />
                  Invite
                </Button>
                {onNewAgent && (
                  <Button variant="secondary" onClick={onNewAgent}>
                    <Icon icon={Robot01Icon} size={16} />
                    New agent
                  </Button>
                )}
                {p.onHold && (hold || onPause) && (
                  <Button
                    variant="secondary"
                    aria-label={hold ? "Resume agents" : "Pause agents"}
                    onClick={() =>
                      hold
                        ? void p.onHold!(false).then(
                            () => toast("Agents may carry on"),
                            (err) => toast(errorText(err), "error")
                          )
                        : onPause?.()
                    }
                  >
                    <Icon icon={hold ? PlayIcon : PauseIcon} size={16} />
                    {hold ? "Resume agents" : "Pause agents"}
                  </Button>
                )}
              </div>
            )}
          </div>

          {picking && (
            <div className="mb-5 max-w-[420px] rounded-card p-2 edge">
              <RobotPicker value={icon?.kind === "robot" ? icon.robot : null} onPick={pickIcon} disabled={savingIcon} />
            </div>
          )}

          {p.isOwner && p.requests.length > 0 && onJoins && (
            <div className="mb-5 flex items-center gap-3 rounded-card bg-decide-wash px-4 py-3">
              <Icon icon={UserMultipleIcon} size={18} className="shrink-0 text-decide" />
              <span className="min-w-0 flex-1 text-ui">
                {p.requests.length === 1 ? (
                  <>
                    <span className="font-semibold">{p.requests[0]!.name}</span> asks to join
                  </>
                ) : (
                  `${p.requests.length} ask to join`
                )}
              </span>
              <Button variant="secondary" onClick={onJoins}>
                Review
              </Button>
            </div>
          )}

          <div className="grid items-start gap-5 md:grid-cols-3">
            <Card icon={UserMultipleIcon} title="Members" sub={`${active.length} ${active.length === 1 ? "member" : "members"}${p.isOwner ? " · pick one for its menu" : ""}`}>
              {active.map((m) => {
                const mine = m.pk === p.myKey
                const row = (
                  <MemberRow
                    name={memberName(m)}
                    handle={m.name}
                    agent={m.kind !== "human"}
                    online={p.online.has(m.name)}
                    color={colorOf(p.state, m.name)}
                    working={!!p.statusOf?.(m.name)?.busy}
                    tag={m.owner ? "owner" : lead === m.name ? "lead" : null}
                    line={mine ? "You" : memberDetail(p, m)}
                    title={m.kind !== "human" ? loadDetail(memberLoad(p.state, m.name)) : undefined}
                    more={p.isOwner && !m.owner}
                  />
                )
                return p.isOwner && !m.owner ? (
                  <MemberActions
                    key={m.pk}
                    m={m}
                    onMessage={onMessage && !mine ? () => onMessage(m.name) : undefined}
                    trigger={
                      <button type="button" aria-label={`More for ${memberName(m)}`} className="block w-full text-left transition-colors hover:bg-wash data-popup-open:bg-wash">
                        {row}
                      </button>
                    }
                  />
                ) : onMessage && !mine ? (
                  <button
                    key={m.pk}
                    type="button"
                    aria-label={`Message ${memberName(m)} privately`}
                    onClick={() => onMessage(m.name)}
                    className="block w-full text-left transition-colors hover:bg-wash"
                  >
                    {row}
                  </button>
                ) : (
                  <div key={m.pk}>{row}</div>
                )
              })}
              {former.length > 0 && (
                <p className="px-4 py-2.5 text-meta text-ink-3">Left: {[...new Set(former.map((m) => (active.some((a) => a.name === m.name) ? `${m.name} (an earlier key)` : m.name)))].join(", ")}</p>
              )}
              {p.isOwner && (
                <button
                  type="button"
                  onClick={onNewAgent ?? (() => setView("invite"))}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-ui font-medium text-accent-text transition-colors hover:bg-wash"
                >
                  <Icon icon={Add01Icon} size={16} className="shrink-0" />
                  {onNewAgent ? "Start an agent" : "Invite someone"}
                </button>
              )}
            </Card>

            {(p.isOwner || p.state.charter || p.state.repos.length > 0 || p.state.voice) && (
              <Card icon={Settings02Icon} title="Channel" sub={p.isOwner ? "Only you change these" : "Set by the owner"}>
                {p.isOwner && p.onRename && (
                  <Row icon={PencilEdit01Icon} onClick={() => openDialog("rename")} detail={title}>
                    Name
                  </Row>
                )}
                {(p.isOwner || p.state.charter) && (
                  <Row icon={BookOpen01Icon} onClick={() => openDialog("charter")} detail={p.state.charter?.text ?? "None yet"}>
                    Charter
                  </Row>
                )}
                {(p.isOwner || p.state.repos.length > 0) && (
                  <Row icon={GithubIcon} onClick={() => setView("repos")} detail={p.state.repos.join(", ") || "None yet"}>
                    Repos
                  </Row>
                )}
                {(p.isOwner ? p.state.repos.length > 0 : p.state.githubWrite !== null) &&
                  (p.isOwner && p.onGithubWrite ? (
                    <Setting
                      icon={GitPullRequestIcon}
                      label="Write to GitHub"
                      hint={p.state.githubWrite !== null ? "Kiwi links new PRs and issues to their tasks, and a task closing closes its issue" : "Kiwi doesn’t comment on or close anything in your repos"}
                    >
                      <Segmented
                        label="Write to GitHub"
                        value={p.state.githubWrite !== null ? "on" : "off"}
                        options={[
                          { value: "off", label: "Off" },
                          { value: "on", label: "On" },
                        ]}
                        onChange={(v) => void p.onGithubWrite!(v === "on").catch((err: unknown) => toast(errorText(err), "error"))}
                      />
                    </Setting>
                  ) : (
                    <Setting icon={GitPullRequestIcon} label="Write to GitHub" hint="On: Kiwi links new PRs and issues to their tasks, and a task closing closes its issue" />
                  ))}
                {(p.isOwner || p.state.voice) &&
                  (p.isOwner && p.onVoice ? (
                    <Setting icon={Mic01Icon} label="Voice" hint={p.state.voice ? "Each person turns it on for themselves in Settings" : "Nobody here can talk to the channel with Grok Voice"}>
                      <Segmented
                        label="Voice"
                        value={p.state.voice ? "on" : "off"}
                        options={[
                          { value: "off", label: "Off" },
                          { value: "on", label: "Allowed" },
                        ]}
                        onChange={(v) => void p.onVoice!(v === "on").catch((err: unknown) => toast(errorText(err), "error"))}
                      />
                    </Setting>
                  ) : (
                    <Setting icon={Mic01Icon} label="Voice" hint="Allowed: each person turns it on for themselves in Settings" />
                  ))}
                {p.isOwner && p.roomId && (
                  <Setting icon={UserAdd01Icon} label="New members can" hint="You confirm it when you let each one in">
                    <Segmented
                      label="New members can"
                      value={readOnly ? "read" : "member"}
                      options={[
                        { value: "read", label: "Only read" },
                        { value: "member", label: "Write and work" },
                      ]}
                      onChange={(v) => newMembers(v === "read")}
                    />
                  </Setting>
                )}
              </Card>
            )}

            <div className="grid gap-5">
              {hasNotes ? (
                notes
              ) : (
                <Card icon={Note01Icon} title="Notes" sub="What agents note for everyone shows here">
                  <p className="px-4 py-3 text-meta text-ink-3">None yet.</p>
                </Card>
              )}
              <Card icon={Delete02Icon} tone="alert" title={p.isOwner ? "Close channel" : "Leave channel"} sub={p.isOwner ? "Deletes it on the relay for everyone" : "You stop getting its messages"}>
                <div className="px-4 py-3">
                  <Button variant="danger" onClick={() => ask(p.isOwner ? { kind: "close" } : { kind: "leave" })}>
                    {p.isOwner ? "Close channel…" : "Leave this channel…"}
                  </Button>
                </div>
              </Card>
            </div>
          </div>

          <p className="mt-6 text-meta text-ink-3">Everything here is end-to-end encrypted: the relay sees only ciphertext, and only members hold the keys.</p>
        </div>
      )}
    </aside>
  )
}

function Card({ icon, title, sub, tone, children }: { icon: IconSvgElement; title: string; sub: string; tone?: "alert"; children: ReactNode }) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-card edge">
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-ctl edge", tone === "alert" ? "text-alert" : "text-ink")}>
          <Icon icon={icon} size={18} />
        </span>
        <span className="min-w-0">
          <span className="block text-title font-semibold">{title}</span>
          <span className="block truncate text-meta text-ink-3">{sub}</span>
        </span>
      </header>
      <div className="[&>*]:shadow-[inset_0_1px_0_var(--line)]">{children}</div>
    </section>
  )
}

function Row({ icon, children, detail, onClick }: { icon: IconSvgElement; children: ReactNode; detail?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-wash">
      <Icon icon={icon} size={16} className="shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1">
        <span className="block text-ui font-medium">{children}</span>
        {detail && <span className="mt-0.5 line-clamp-2 block text-meta text-ink-3">{detail}</span>}
      </span>
      <Icon icon={ArrowRight01Icon} size={14} className="shrink-0 text-ink-3" />
    </button>
  )
}

function Setting({ icon, label, hint, children }: { icon: IconSvgElement; label: string; hint: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <Icon icon={icon} size={16} className="shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1">
          <span className="block text-ui font-medium">{label}</span>
          <span className="block text-meta text-ink-3">{hint}</span>
        </span>
      </div>
      {children && <div className="mt-2.5">{children}</div>}
    </div>
  )
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("grid gap-0.5", SEGMENTED)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => value !== o.value && onChange(o.value)}
          className={cx("h-7 rounded-row px-2 text-ui font-medium transition-colors", value === o.value ? SEGMENT_ON : SEGMENT_OFF)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function MemberRow({
  name,
  handle,
  agent,
  online,
  color,
  working,
  tag,
  line,
  title,
  more,
}: {
  name: string
  handle: string
  agent: boolean
  online: boolean
  color: ReturnType<typeof colorOf>
  working: boolean
  tag: string | null
  line: string
  title?: string
  more: boolean
}) {
  return (
    <span className="flex items-center gap-3 px-4 py-2.5" title={title}>
      <Monogram name={name} hue={handle} agent={agent} size={36} online={online} color={color} working={working} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-ui font-semibold" title={`@${handle}`}>
            {name}
          </span>
          {tag && <span className="shrink-0 rounded-row px-1.5 text-stamp font-medium text-ink-3 edge">{tag}</span>}
        </span>
        <span className="block truncate text-meta text-ink-3">{line}</span>
      </span>
      {more && <Icon icon={ArrowRight01Icon} size={14} className="shrink-0 text-ink-3" />}
    </span>
  )
}
