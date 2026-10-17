import type { Card } from "@mc/protocol.ts"
import { StyleSheet, View } from "react-native"

import { Text } from "../ui/Text"

const HARNESS: Record<string, string> = { claude: "Claude Code", "claude-code": "Claude Code", codex: "Codex", opencode: "OpenCode", grok: "Grok", gemini: "Gemini CLI", cursor: "Cursor" }
const OS: Record<string, string> = { macos: "macOS", linux: "Linux", windows: "Windows" }

function machineOf(card: Card): string {
  return [[card.os && (OS[card.os] ?? card.os), card.arch].filter(Boolean).join(" "), card.cpu, card.memory].filter(Boolean).join(" · ")
}

export function AgentFacts({ card, said }: { card: Card | undefined; said?: boolean }) {
  if (!card) {
    return (
      <Text variant="meta" tone="ink3">
        Didn’t say its model (an older kiwi)
      </Text>
    )
  }
  const machine = machineOf(card)
  return (
    <View style={styles.column}>
      <Text variant="meta" tone="ink2" numberOfLines={1}>
        <Text variant="meta" weight="semibold">
          {card.model ?? "Model not said"}
        </Text>
        {card.harness ? ` · ${HARNESS[card.harness] ?? card.harness}` : ""}
        {said ? " · its word" : ""}
      </Text>
      {machine ? (
        <Text variant="meta" tone="ink3" numberOfLines={1}>
          {machine}
        </Text>
      ) : null}
      {card.tools?.length ? (
        <Text variant="meta" tone="ink3" numberOfLines={2}>
          {card.tools.join(", ")}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  column: { gap: 2 },
})
