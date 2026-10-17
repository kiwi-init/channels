import type { Message } from "@mc/protocol.ts"
import type { ChannelState } from "@mc/state.ts"
import { useMemo, type ReactNode } from "react"
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { repliesLabel } from "../lib/thread"
import { useTheme } from "../theme/useTheme"
import { Text } from "../ui/Text"
import { Bubble } from "./Bubble"

export interface ThreadProps {
  root: Message
  replies: readonly Message[]
  state: ChannelState
  me: string
  nameOf: (name: string) => string
  composer: ReactNode
  onClose: () => void
}

export function Thread({ root, replies, state, me, nameOf, composer, onClose }: ThreadProps) {
  const { colors } = useTheme()
  const all = useMemo(() => [root, ...replies], [root, replies])
  const bySeq = useMemo(() => new Map(all.map((m) => [m.seq, m])), [all])
  const quoted = (seq: number) => bySeq.get(seq)
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={[styles.header, { borderBottomColor: colors.line }]}>
        <Text variant="title" style={styles.title}>
          Thread{" "}
          <Text variant="ui" tone="ink3">
            {repliesLabel(replies.length).toLowerCase()}
          </Text>
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close thread" onPress={onClose}>
          <Text variant="ui" weight="medium" tone="accentText">
            Close
          </Text>
        </Pressable>
      </View>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <FlatList
          data={all}
          keyExtractor={(m) => String(m.seq)}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => (
            <Bubble
              m={item}
              me={me}
              trust={state.trust.get(item.seq)}
              first={index === 0 || all[index - 1]!.from !== item.from}
              last={index === all.length - 1 || all[index + 1]!.from !== item.from}
              group
              adjacentReply={index > 0 && !!item.re?.includes(all[index - 1]!.seq)}
              quoted={quoted}
              nameOf={nameOf}
              onJump={() => {}}
            />
          )}
        />
        {composer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fill: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1 },
  list: { paddingVertical: 12 },
})
