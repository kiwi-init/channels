import { useRouter } from "expo-router"
import { useEffect, useMemo, useState } from "react"
import { StyleSheet, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { JoinSheet } from "../src/components/JoinSheet"
import { NewChannelSheet } from "../src/components/NewChannelSheet"
import { useEngine, usePerson, useSeats, useServices } from "../src/lib/EngineProvider"
import { joinCodeFromInput } from "../src/lib/deep-link"
import { previewOf, type Preview } from "../src/lib/listPreview"
import { takeJoin } from "../src/lib/pendingJoin"
import { FirstRun } from "../src/screens/FirstRun"
import { useTheme } from "../src/theme/useTheme"
import { ChannelList, type ChannelRowView } from "../src/ui/ChannelList"
import { Text } from "../src/ui/Text"
import { toast } from "../src/ui/Toast"

export default function Home() {
  const router = useRouter()
  const engine = useEngine()
  const person = usePerson()
  const { colors } = useTheme()
  const { joined, waiting } = useSeats()
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [now] = useState(() => Date.now())
  const { history, sql } = useServices()
  const [previews, setPreviews] = useState<ReadonlyMap<string, Preview>>(new Map())
  const me = person?.name ?? ""

  useEffect(() => {
    let live = true
    void (async () => {
      const next = new Map<string, Preview>()
      for (const seat of joined) {
        if (!seat.code || !seat.roomId || !seat.access) continue
        const access = seat.access as { keys?: Record<string, string> }
        next.set(seat.code, await previewOf(history, sql, { roomId: seat.roomId, memberPk: seat.pk, me: seat.idName ?? me, keys: access.keys ?? {} }))
      }
      if (live) setPreviews(next)
    })()
    return () => {
      live = false
    }
  }, [joined, history, sql, me])

  const rows: ChannelRowView[] = useMemo(
    () => [
      ...waiting.map((seat) => ({ code: seat.code ?? "", room: seat.roomId ?? "", title: seat.name || seat.label || "Channel", state: "pending" as const, agents: 0, ts: seat.at ?? 0, recent: null })),
      ...joined.map((seat) => ({
        code: seat.code ?? "",
        room: seat.roomId ?? "",
        title: seat.name || seat.label || "Channel",
        state: "member" as const,
        agents: 0,
        ts: previews.get(seat.code ?? "")?.ts ?? seat.at ?? 0,
        recent: previews.get(seat.code ?? "")?.recent ?? null,
      })),
    ],
    [joined, waiting, previews]
  )
  const hasPerson = !!person
  useEffect(() => {
    if (!hasPerson) return
    const held = takeJoin()
    if (held) router.replace({ pathname: "/join/[code]", params: { code: held } })
  }, [hasPerson, router])
  const news = useMemo(() => rows.map((row) => ({ fresh: previews.get(row.code)?.fresh ?? false, needs: 0 })), [rows, previews])

  if (!person) return <FirstRun onContinue={async (name) => void (await engine.createPerson(name))} onLink={() => router.push("/link")} />

  const open = (code: string) => {
    const waitingSeat = waiting.find((seat) => seat.code === code)
    router.push(waitingSeat ? { pathname: "/join/[code]", params: { code } } : { pathname: "/channel/[code]", params: { code } })
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={styles.header}>
        <Text variant="display">Channels</Text>
      </View>
      <ChannelList rows={rows} news={news} now={now} onSelect={open} onNew={() => setCreating(true)} />
      <Text variant="meta" tone="ink3" accessibilityRole="button" accessibilityLabel="Open the gallery" onPress={() => router.push("/gallery")} style={styles.gallery}>
        Gallery
      </Text>
      <NewChannelSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onCreate={(name) => engine.createChannel(name)}
        onCreated={(code) => router.push({ pathname: "/channel/[code]", params: { code } })}
        onJoin={() => {
          setCreating(false)
          setJoining(true)
        }}
      />
      <JoinSheet
        visible={joining}
        onClose={() => setJoining(false)}
        onJoin={(text) => {
          const code = joinCodeFromInput(text)
          if (!code) return toast("That isn’t a join code.", "error")
          setJoining(false)
          router.push({ pathname: "/join/[code]", params: { code } })
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  gallery: { textAlign: "center", paddingVertical: 8 },
})
