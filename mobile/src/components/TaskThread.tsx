import type { ImageAttachment, Message } from "@mc/protocol.ts"
import type { ChannelState } from "@mc/state.ts"
import { useMemo, useState } from "react"
import { StyleSheet, View } from "react-native"

import { Button } from "../ui/Button"
import { Text } from "../ui/Text"
import { TextField } from "../ui/TextField"
import { Bubble } from "./Bubble"

export interface TaskThreadProps {
  messages: readonly Message[]
  state: ChannelState
  me: string
  nameOf: (name: string) => string
  blocked?: string | null
  onSend: (text: string) => Promise<void>
  onOpenImage?: (img: ImageAttachment) => void
  loadImage?: (img: ImageAttachment) => Promise<string | null>
}

export function TaskThread({ messages, state, me, nameOf, blocked, onSend, onOpenImage, loadImage }: TaskThreadProps) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const bySeq = useMemo(() => new Map(messages.map((m) => [m.seq, m])), [messages])
  const quoted = (seq: number) => bySeq.get(seq)

  const send = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      await onSend(text.trim())
      setText("")
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.section}>
      <Text variant="ui" weight="semibold">
        {`Conversation ${messages.length}`}
      </Text>
      {messages.length === 0 ? (
        <Text variant="ui" tone="ink3">
          Nothing said here yet.
        </Text>
      ) : (
        <View>
          {messages.map((m, index) => (
            <Bubble
              key={m.seq}
              m={m}
              me={me}
              trust={state.trust.get(m.seq)}
              first={index === 0 || messages[index - 1]!.from !== m.from}
              last={index === messages.length - 1 || messages[index + 1]!.from !== m.from}
              group
              adjacentReply={index > 0 && !!m.re?.includes(messages[index - 1]!.seq)}
              quoted={quoted}
              nameOf={nameOf}
              onJump={() => {}}
              onOpenImage={onOpenImage}
              loadImage={loadImage}
            />
          ))}
        </View>
      )}
      {blocked ? (
        <Text variant="ui" tone="ink3">
          {blocked}
        </Text>
      ) : (
        <>
          <TextField label="Say something in this task" value={text} onChangeText={setText} multiline />
          <Button title="Send" size="sm" disabled={!text.trim() || busy} onPress={() => void send()} />
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 8, marginTop: 8 },
})
