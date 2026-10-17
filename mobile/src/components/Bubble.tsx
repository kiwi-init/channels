import type { ImageAttachment, Message, Trust } from "@mc/protocol.ts"
import { ignored } from "@mc/protocol.ts"
import { memo, type ReactNode } from "react"
import { Image, Pressable, StyleSheet, View } from "react-native"
import Svg, { Path } from "react-native-svg"

import { excerpt, forgedNote, isImageOnly, phrase } from "../lib/bubble"
import { useTheme } from "../theme/useTheme"
import { Text } from "../ui/Text"
import type { Chip } from "../lib/reactions"
import { Markdown } from "./Markdown"
import { ReactionChip } from "./ReactionChip"

export interface BubbleProps {
  m: Message
  me: string
  trust?: Trust
  first: boolean
  last: boolean
  group: boolean
  adjacentReply: boolean
  highlighted?: boolean
  receipt?: string
  direct?: string
  reactions?: Chip[]
  face?: ReactNode
  quoted: (seq: number) => Message | undefined
  nameOf: (name: string) => string
  onJump: (seq: number) => void
  onReply?: (m: Message) => void
}

const TAIL = "M0 20V0H20C20 9 22 15.5 27.5 19.6C23 20.4 19.5 19.8 16.6 18.3C13.7 16.8 8 20 0 20Z"

function Tail({ mine, color }: { mine: boolean; color: string }) {
  return (
    <View pointerEvents="none" testID="tail" style={[styles.tail, mine ? styles.tailRight : styles.tailLeft]}>
      <Svg width={28} height={20} viewBox="0 0 28 20" style={mine ? undefined : styles.flip}>
        <Path d={TAIL} fill={color} />
      </Svg>
    </View>
  )
}

function Attached({ img }: { img: ImageAttachment }) {
  const theme = useTheme()
  if (!img.data) {
    return (
      <View style={[styles.imageHolder, { backgroundColor: theme.colors.wash, borderRadius: theme.radius.bubble }]}>
        <Text variant="stamp" tone="ink3">
          Loading image…
        </Text>
      </View>
    )
  }
  return <Image accessibilityLabel={img.name} source={{ uri: `data:${img.mime};base64,${img.data}` }} style={[styles.image, { borderRadius: theme.radius.bubble }]} />
}

export const Bubble = memo(function Bubble({ m, me, trust, first, last, group, adjacentReply, highlighted, receipt, direct, reactions, face, quoted, nameOf, onJump, onReply }: BubbleProps) {
  const theme = useTheme()
  const forged = ignored(trust)
  const mine = m.from === me
  const repliedTo = new Set((m.re ?? []).map((seq) => quoted(seq)?.from).filter((from): from is string => !!from))
  const said = mine && !m.esc ? null : phrase(m, me, nameOf, repliedTo)
  const quotes = adjacentReply ? [] : (m.re ?? []).map((seq) => ({ seq, q: quoted(seq) })).filter(({ q }) => !q || q.kind !== "event")
  const fill = mine ? theme.colors.bubbleMe : theme.colors.bubbleThem
  const align = mine ? "flex-end" : "flex-start"

  return (
    <View testID={`bubble-${m.seq}`} style={[styles.row, { marginTop: first ? 12 : 2, justifyContent: align }]}>
      {!mine && <View style={styles.face}>{last ? face : null}</View>}
      <View style={[styles.column, { alignItems: align }]}>
        {first && (!mine || said) && (
          <View style={[styles.header, { justifyContent: align }]}>
            {!mine && group && (
              <Text variant="stamp" weight="medium" tone="ink2">
                {nameOf(m.from)}
              </Text>
            )}
            {said ? (
              said.decide ? (
                <View style={[styles.decide, { backgroundColor: theme.colors.decideWash }]}>
                  <Text variant="stamp" weight="semibold" tone="decide">
                    {said.text}
                  </Text>
                </View>
              ) : (
                <Text variant="stamp" weight={said.alert ? "semibold" : "regular"} tone={said.alert ? "alert" : "ink3"}>
                  {said.text}
                </Text>
              )
            ) : null}
          </View>
        )}

        {quotes.map(({ seq, q }) => (
          <Pressable key={seq} accessibilityRole="button" accessibilityLabel={`Jump to message ${seq}`} onPress={() => onJump(seq)} style={styles.quote}>
            <Text variant="stamp" tone="ink3" numberOfLines={1}>
              <Text variant="stamp" weight="medium" tone="ink2">
                {q ? nameOf(q.from) : "Earlier message"}
              </Text>
              {q ? ` ${excerpt(q.body, 80)}` : ""}
            </Text>
          </Pressable>
        ))}

        {!isImageOnly(m) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Message"
            onLongPress={onReply ? () => onReply(m) : undefined}
            style={[styles.bubble, { backgroundColor: fill, borderRadius: theme.radius.bubble }, forged && styles.forged, highlighted && { borderWidth: 2, borderColor: theme.colors.ring }]}
          >
            <Markdown tone={mine ? "bubbleMeInk" : "bubbleThemInk"}>{m.body}</Markdown>
            {last ? <Tail mine={mine} color={fill} /> : null}
          </Pressable>
        )}

        {m.imgs?.length ? (
          <View style={[styles.images, { justifyContent: align }]}>
            {m.imgs.map((img, index) => (
              <Attached key={index} img={img} />
            ))}
          </View>
        ) : null}

        {reactions?.length && !forged ? (
          <View style={[styles.reactions, { justifyContent: align }]}>
            {reactions.map((chip) => (
              <ReactionChip key={chip.emoji} chip={chip} />
            ))}
          </View>
        ) : null}
        {receipt && mine && !forged ? (
          <Text variant="stamp" tone="ink3" style={styles.note}>
            {receipt}
          </Text>
        ) : null}
        {direct && !forged ? (
          <Text variant="stamp" tone="ink3" style={styles.note}>
            {`Sent directly, not through ${nameOf(direct)}.`}
          </Text>
        ) : null}
        {forged && (trust === "forged" || trust === "refused") ? (
          <Text variant="stamp" tone="alert" style={styles.note}>
            {forgedNote(m, trust)}
          </Text>
        ) : null}
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12 },
  face: { width: 28 },
  column: { maxWidth: "80%", minWidth: 0 },
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, marginBottom: 4 },
  decide: { borderRadius: 999, paddingHorizontal: 6 },
  quote: { paddingHorizontal: 12, marginBottom: 2 },
  bubble: { paddingHorizontal: 14, paddingVertical: 7, maxWidth: "100%" },
  forged: { opacity: 0.6 },
  images: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 },
  image: { width: 180, height: 180 },
  imageHolder: { width: 128, height: 96, alignItems: "center", justifyContent: "center" },
  reactions: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2, paddingHorizontal: 8 },
  note: { paddingHorizontal: 12, marginTop: 2 },
  tail: { position: "absolute", bottom: 0, zIndex: -1, width: 28, height: 20 },
  tailRight: { right: -8 },
  tailLeft: { left: -8 },
  flip: { transform: [{ scaleX: -1 }] },
})
