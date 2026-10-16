import { useState } from "react"
import { Image, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputContentSizeChangeEvent, type TextInputSelectionChangeEvent } from "react-native"

import { completeMention, matchPeople, mentionQuery, recipients, type Person } from "../lib/mentions"
import { useTheme } from "../theme/useTheme"
import { IconButton } from "./IconButton"
import { Text } from "./Text"
import { toast } from "./Toast"

export type { Person }

export interface Attachment {
  id: string
  name: string
  uri: string
}

interface ReplyTo {
  label: string
  text: string
}

interface Draft {
  body: string
  to: string[]
}

export interface ComposerProps {
  me: string
  people: readonly Person[]
  onSend: (draft: Draft) => Promise<void> | void
  disabled?: boolean
  placeholder?: string
  attachments?: readonly Attachment[]
  onAttach?: () => void
  onRemoveAttachment?: (id: string) => void
  replyTo?: ReplyTo | null
  onClearReply?: () => void
}

const MIN_HEIGHT = 36
const MAX_HEIGHT = 220

function failure(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function Composer({ me, people, onSend, disabled, placeholder = "Message", attachments = [], onAttach, onRemoveAttachment, replyTo, onClearReply }: ComposerProps) {
  const { colors, radius } = useTheme()
  const [body, setBody] = useState("")
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [height, setHeight] = useState(MIN_HEIGHT)
  const [sending, setSending] = useState(false)

  const others = people.filter((p) => p.name !== me)
  const query = mentionQuery(body, selection.end > body.length ? body.length : selection.end)
  const matches = query === null ? [] : matchPeople(others, query)
  const canSend = !disabled && !sending && (body.trim().length > 0 || attachments.length > 0)

  const onSelectionChange = (e: TextInputSelectionChangeEvent) => setSelection(e.nativeEvent.selection)
  const onContentSizeChange = (e: TextInputContentSizeChangeEvent) => setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.ceil(e.nativeEvent.contentSize.height))))

  const complete = (person: Person) => {
    const next = completeMention(body, selection.end, person)
    setBody(next.text)
    setSelection({ start: next.caret, end: next.caret })
  }

  const submit = async () => {
    if (!canSend) return
    setSending(true)
    try {
      const text = body.trim() || attachments.map((a) => a.name).join(", ")
      await onSend({ body: text, to: recipients(text, new Set(others.map((p) => p.name))) })
      setBody("")
      setSelection({ start: 0, end: 0 })
      setHeight(MIN_HEIGHT)
      onClearReply?.()
    } catch (err) {
      toast(`Not sent: ${failure(err)}`, "error")
    } finally {
      setSending(false)
    }
  }

  return (
    <View style={styles.column}>
      {matches.length > 0 ? (
        <View accessibilityRole="menu" style={[styles.menu, { backgroundColor: colors.raised, borderRadius: radius.card, borderColor: colors.line }]}>
          {matches.map((p) => (
            <Pressable
              key={p.name}
              accessibilityRole="menuitem"
              accessibilityLabel={`Mention ${p.label}`}
              onPress={() => complete(p)}
              style={({ pressed }) => [styles.match, { borderRadius: radius.row, backgroundColor: pressed ? colors.wash2 : "transparent" }]}
            >
              <Text variant="ui" weight="medium" numberOfLines={1}>
                {p.label}
              </Text>
              <Text variant="meta" tone="ink3" numberOfLines={1}>
                @{p.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={[styles.field, { backgroundColor: colors.raised, borderRadius: radius.dock, borderColor: colors.line }]}>
        {replyTo ? (
          <View style={styles.reply}>
            <View style={styles.replyText}>
              <Text variant="meta" weight="medium" tone="ink2" numberOfLines={1}>
                Replying to {replyTo.label}
              </Text>
              <Text variant="meta" tone="ink3" numberOfLines={1}>
                {replyTo.text}
              </Text>
            </View>
            {onClearReply ? (
              <IconButton label="Cancel reply" round size={28} onPress={onClearReply}>
                {(color) => (
                  <Text variant="ui" style={{ color }}>
                    ×
                  </Text>
                )}
              </IconButton>
            ) : null}
          </View>
        ) : null}

        {attachments.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {attachments.map((a) => (
              <View key={a.id} style={styles.chip}>
                <Image source={{ uri: a.uri }} accessibilityLabel={a.name} style={[styles.thumb, { borderRadius: radius.card, backgroundColor: colors.wash2 }]} />
                {onRemoveAttachment ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${a.name}`}
                    onPress={() => onRemoveAttachment(a.id)}
                    hitSlop={8}
                    style={[styles.remove, { backgroundColor: colors.ink }]}
                  >
                    <Text variant="stamp" tone="bubbleMeInk" style={{ color: colors.canvas }}>
                      ×
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.row}>
          {onAttach ? (
            <IconButton label="Attach images" round size={36} disabled={disabled || attachments.length >= 8} onPress={onAttach}>
              {(color) => (
                <Text variant="title" style={{ color }}>
                  +
                </Text>
              )}
            </IconButton>
          ) : null}
          <TextInput
            accessibilityLabel="Message"
            placeholder={placeholder}
            placeholderTextColor={colors.ink3}
            value={body}
            onChangeText={setBody}
            selection={selection}
            onSelectionChange={onSelectionChange}
            onContentSizeChange={onContentSizeChange}
            editable={!disabled}
            multiline
            style={[styles.input, { height, color: colors.ink }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={() => void submit()}
            style={({ pressed }) => [styles.send, { backgroundColor: colors.accent, opacity: !canSend ? 0.4 : pressed ? 0.8 : 1 }]}
          >
            <Text variant="title" tone="accentInk">
              ↑
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  column: { gap: 6 },
  menu: { borderWidth: StyleSheet.hairlineWidth, padding: 4 },
  match: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  field: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 6, paddingVertical: 6 },
  reply: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingBottom: 6 },
  replyText: { flex: 1 },
  chips: { gap: 8, paddingHorizontal: 6, paddingBottom: 8 },
  chip: { width: 64, height: 64 },
  thumb: { width: 64, height: 64 },
  remove: { position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  input: { flex: 1, paddingTop: 8, paddingBottom: 8, paddingHorizontal: 6, fontSize: 15 },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 0 },
})
