import { ArrowUp01Icon } from "@hugeicons/core-free-icons"
import { useState } from "react"
import { Pressable, ScrollView, StyleSheet, View } from "react-native"

import { byBusy, summarize, type AgentNow } from "../lib/agents"
import { useTheme } from "../theme/useTheme"
import { Icon } from "../ui/Icon"
import { Monogram } from "../ui/Monogram"
import { Sheet } from "../ui/Sheet"
import { Text } from "../ui/Text"
import { AgentFacts } from "./AgentFacts"
import { AgentLine } from "./AgentLine"

export interface AgentStripProps {
  agents: readonly AgentNow[]
  now: number
  onOpenTask: (id: number) => void
}

export function AgentStrip({ agents, now, onOpenTask }: AgentStripProps) {
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  if (!agents.length) return null
  const ordered = byBusy(agents)
  const { count, line, faces } = summarize(agents)
  const sheetAgent = agents.find((a) => a.name === picked) ?? null
  return (
    <View style={[styles.strip, { borderTopColor: colors.line }]}>
      {open ? (
        <ScrollView accessibilityLabel="What the agents are doing" style={styles.list}>
          {ordered.map((a) => (
            <AgentLine key={a.name} a={a} now={now} onOpenTask={onOpenTask} onPress={(one) => setPicked(one.name)} brief />
          ))}
        </ScrollView>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`${count}. ${line}`} accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)} style={styles.bar}>
        <View style={styles.faces}>
          {faces.map((a, i) => (
            <View key={a.name} style={[styles.overlap, { marginLeft: i === 0 ? 0 : -6, borderColor: colors.canvas }]}>
              <Monogram name={a.label} hue={a.name} agent color={a.color} size={20} />
            </View>
          ))}
        </View>
        <Text variant="meta" tone="ink2" numberOfLines={1} style={styles.summary}>
          <Text variant="meta" weight="semibold">
            {count}
          </Text>
          {` · ${line}`}
        </Text>
        <View style={open ? styles.flipped : undefined}>
          <Icon icon={ArrowUp01Icon} size={14} color={colors.ink3} />
        </View>
      </Pressable>
      <Sheet visible={sheetAgent !== null} onClose={() => setPicked(null)} title={sheetAgent?.label}>
        {sheetAgent ? (
          <View style={styles.sheet}>
            <AgentLine
              a={sheetAgent}
              now={now}
              onOpenTask={(id) => {
                setPicked(null)
                onOpenTask(id)
              }}
            />
            <AgentFacts card={sheetAgent.card} />
          </View>
        ) : null}
      </Sheet>
    </View>
  )
}

const styles = StyleSheet.create({
  strip: { borderTopWidth: StyleSheet.hairlineWidth },
  list: { maxHeight: 288, paddingHorizontal: 6, paddingTop: 6 },
  bar: { height: 36, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 },
  faces: { flexDirection: "row" },
  overlap: { borderRadius: 999, borderWidth: 2 },
  summary: { flex: 1 },
  flipped: { transform: [{ rotate: "180deg" }] },
  sheet: { gap: 12, paddingBottom: 8 },
})
