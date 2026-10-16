import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useMemo } from "react"

import { Conversation } from "../components/Conversation"
import { useServices } from "../lib/EngineProvider"
import { useChannel } from "../lib/useChannel"
import { useTheme } from "../theme/useTheme"
import { Composer, type Person } from "../ui/Composer"
import { Text } from "../ui/Text"
import { toast } from "../ui/Toast"

export function ChannelScreen({ code, onBack }: { code: string; onBack?: () => void }) {
  const { colors } = useTheme()
  const { engine, history, sql } = useServices()
  const seat = engine.joined().find((entry) => entry.code === code)
  const channel = useMemo(() => engine.channel(code), [engine, code])
  const live = useChannel(channel, seat?.pk ?? "", history, sql)
  const me = channel?.identity.name ?? ""

  const people: Person[] = useMemo(
    () =>
      [...live.state.members.values()]
        .filter((member) => member.active && member.name !== me)
        .map((member) => ({ name: member.name, label: member.display || member.name, agent: member.kind !== "human" })),
    [live.state, me]
  )
  const nameOf = useMemo(() => (name: string) => live.state.members.get(name)?.display || name, [live.state])

  if (!channel) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
        <Text tone="ink2" style={styles.missing}>
          This channel is not on this phone.
        </Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={[styles.header, { borderBottomColor: colors.line }]}>
        <Text variant="ui" weight="medium" tone="accentText" onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to channels">
          Channels
        </Text>
        <Text variant="title" numberOfLines={1} style={styles.title}>
          {seat?.name || seat?.label || "Channel"}
        </Text>
        <Text variant="stamp" tone={live.connected ? "live" : "ink3"}>
          {live.connected ? "Live" : "Connecting"}
        </Text>
      </View>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Conversation messages={live.messages} state={live.state} me={me} nameOf={nameOf} group={people.length > 1} />
        <Composer
          me={me}
          people={people}
          onSend={async ({ body, to }) => {
            try {
              await live.send(body, to)
            } catch (err) {
              toast(err instanceof Error ? err.message : "Could not send", "error")
              throw err
            }
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fill: { flex: 1 },
  missing: { padding: 24 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1 },
})
