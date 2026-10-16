import type { ChannelIdentityView } from "../lib/secrets"
import { FlatList, Pressable, StyleSheet, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { useTheme } from "../theme/useTheme"
import { Button } from "../ui/Button"
import { Text } from "../ui/Text"

export interface ChannelListProps {
  joined: readonly ChannelIdentityView[]
  waiting: readonly ChannelIdentityView[]
  onOpen: (code: string) => void
  onJoin: () => void
  onOpenWaiting: (code: string) => void
}

const title = (seat: ChannelIdentityView): string => seat.name || seat.label || "Channel"

export function ChannelList({ joined, waiting, onOpen, onJoin, onOpenWaiting }: ChannelListProps) {
  const { colors } = useTheme()
  const rows = [...waiting.map((seat) => ({ seat, waiting: true })), ...joined.map((seat) => ({ seat, waiting: false }))]
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={styles.header}>
        <Text variant="display">Channels</Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={({ seat }) => seat.code || seat.pk}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text tone="ink2">No channels yet. Join one with an invite link or code.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.waiting ? "Waiting to join " : "Open "}${title(item.seat)}`}
            onPress={() => (item.seat.code ? (item.waiting ? onOpenWaiting(item.seat.code) : onOpen(item.seat.code)) : undefined)}
            style={[styles.row, { borderBottomColor: colors.line }]}
          >
            <Text variant="title" numberOfLines={1}>
              {title(item.seat)}
            </Text>
            <Text variant="meta" tone="ink3">
              {item.waiting ? "Waiting for the owner" : "Joined"}
            </Text>
          </Pressable>
        )}
      />
      <View style={styles.footer}>
        <Button title="Join a channel" onPress={onJoin} />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  empty: { padding: 24 },
  row: { paddingHorizontal: 20, paddingVertical: 14, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  footer: { padding: 16 },
})
