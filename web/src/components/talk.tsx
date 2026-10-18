import { AudioWave01Icon, CallEnd01Icon } from "@hugeicons/core-free-icons"
import { useEffect, useSyncExternalStore } from "react"

import type { Message } from "@kiwi/core/protocol.ts"
import type { ChannelState } from "@kiwi/core/state.ts"
import { bridge } from "@/lib/secrets"
import { cx } from "@/lib/utils"
import type { Talk, TalkChannel, TalkView } from "@/lib/voice/talk"
import { Icon } from "./icon"
import { toast } from "./kit"

let view: TalkView = { status: "off", heard: "", saying: "", error: null }
const listeners = new Set<() => void>()
let loading: Promise<Talk> | null = null

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const snapshot = () => view

function load(): Promise<Talk> {
  loading ??= Promise.all([import("@/lib/voice/talk"), import("@/lib/voice/audio")]).then(([t, audio]) => {
    const b = bridge()
    const talk = t.createTalk({
      token: (roomId) => (b ? b.voiceToken(roomId) : Promise.reject(new Error("Voice works in the Channels app for Mac."))),
      mic: audio.openMic,
      speaker: audio.openSpeaker,
    })
    talk.subscribe(() => {
      view = talk.view()
      for (const l of listeners) l()
    })
    return talk
  })
  return loading
}

export function TalkButton({ channel, disabled }: { channel: TalkChannel; disabled?: boolean }) {
  const v = useSyncExternalStore(subscribe, snapshot, snapshot)
  const on = v.status !== "off"
  useEffect(() => {
    if (v.error) toast(v.error, "error")
  }, [v.error])
  return (
    <button
      type="button"
      aria-label={on ? "End talk" : "Talk to channel"}
      aria-pressed={on}
      title={on ? "End talk" : "Talk to channel (Grok Voice)"}
      disabled={disabled}
      onClick={() => void load().then((t) => (on ? t.stop() : t.start(channel)))}
      className={cx(
        "my-1.5 ml-1.5 flex size-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40",
        on ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-wash hover:text-ink"
      )}
    >
      <Icon icon={on ? CallEnd01Icon : AudioWave01Icon} size={17} strokeWidth={2} />
    </button>
  )
}

export function TalkBar({ messages, state, nameOf, me }: { messages: Message[]; state: ChannelState; nameOf: (name: string) => string; me: string }) {
  const v = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    if (v.status === "off" || !loading) return
    void loading.then((t) => t.seen(messages, state))
  }, [messages, state, v.status])
  if (v.status === "off") return null
  const caption = v.saying ? v.saying : v.heard ? `${nameOf(me)}: ${v.heard}` : v.status === "connecting" ? "Connecting to Grok Voice…" : "Listening"
  return (
    <div role="status" aria-label="Voice" className="mx-3 mb-1.5 flex items-center gap-2.5 px-2">
      <span aria-hidden className={cx("size-2 shrink-0 rounded-full", v.status === "live" ? "animate-pulse bg-live" : "bg-ink-3")} />
      <span className="min-w-0 flex-1">
        <span className="block text-meta font-medium text-ink-2">voice: Grok Voice hears this</span>
        <span className="block truncate text-ui text-ink">{caption}</span>
      </span>
      <button
        type="button"
        onClick={() => void loading?.then((t) => t.stop())}
        className="shrink-0 rounded-row border border-edge-strong px-2.5 py-1 text-ui text-ink transition-colors hover:border-alert hover:text-alert"
      >
        End
      </button>
    </div>
  )
}
