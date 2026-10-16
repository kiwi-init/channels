import type { Code, InlineCode, PhrasingContent, RootContent, Table } from "mdast"
import * as Clipboard from "expo-clipboard"
import { memo, useMemo, useState, type ReactNode } from "react"
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native"

import { compareCells, hostOf, nextSort, parseMarkdown, safeUrl, type SortDir } from "../lib/markdown"
import { Text, type Tone } from "../ui/Text"
import { useTheme } from "../theme/useTheme"

interface Look {
  tone: Tone
}

function plain(nodes: readonly PhrasingContent[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text" || node.type === "inlineCode") return node.value
      if (node.type === "break") return " "
      return "children" in node ? plain(node.children) : ""
    })
    .join("")
}

function Inline({ nodes, look }: { nodes: readonly PhrasingContent[]; look: Look }): ReactNode {
  const theme = useTheme()
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.value
      case "strong":
        return (
          <Text key={index} weight="semibold" tone={look.tone}>
            <Inline nodes={node.children} look={look} />
          </Text>
        )
      case "emphasis":
        return (
          <Text key={index} tone={look.tone} style={styles.italic}>
            <Inline nodes={node.children} look={look} />
          </Text>
        )
      case "delete":
        return (
          <Text key={index} tone={look.tone} style={styles.struck}>
            <Inline nodes={node.children} look={look} />
          </Text>
        )
      case "inlineCode":
        return (
          <Text key={index} mono variant="ui" tone={look.tone} style={{ backgroundColor: theme.colors.wash2 }}>
            {node.value}
          </Text>
        )
      case "break":
        return "\n"
      case "link": {
        const url = safeUrl(node.url)
        if (!url) return <Inline key={index} nodes={node.children} look={look} />
        return (
          <Text key={index} accessibilityRole="link" style={{ color: theme.colors.link }} onPress={() => void Linking.openURL(url)}>
            <Inline nodes={node.children} look={look} />
          </Text>
        )
      }
      case "image": {
        const url = safeUrl(node.url)
        const host = url ? hostOf(url) : undefined
        const label = node.alt || "image"
        if (!url || !host) return label
        return (
          <Text key={index} accessibilityRole="link" style={{ color: theme.colors.link }} onPress={() => void Linking.openURL(url)}>
            {`${label} (opens ${host})`}
          </Text>
        )
      }
      default:
        return "children" in node ? <Inline key={index} nodes={node.children} look={look} /> : null
    }
  })
}

function CodeBlock({ node }: { node: Code | InlineCode }) {
  const theme = useTheme()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await Clipboard.setStringAsync(node.value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <View style={[styles.block, { backgroundColor: theme.colors.wash2, borderRadius: theme.radius.ctl }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeScroll}>
        <Text mono variant="ui">
          {node.value}
        </Text>
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel={copied ? "Copied" : "Copy code"} onPress={() => void copy()} style={styles.copy}>
        <Text variant="meta" tone="ink3">
          {copied ? "Copied" : "Copy"}
        </Text>
      </Pressable>
    </View>
  )
}

function MarkdownTable({ node, look }: { node: Table; look: Look }) {
  const theme = useTheme()
  const [sort, setSort] = useState<{ column: number; direction: SortDir } | null>(null)
  const [head, ...body] = node.children
  const rows = useMemo(() => {
    const indexed = body.map((row, index) => ({ row, index }))
    if (!sort) return indexed
    return indexed.sort((a, b) => {
      const compared = compareCells(plain(a.row.children[sort.column]?.children ?? []), plain(b.row.children[sort.column]?.children ?? []))
      if (compared === 0) return a.index - b.index
      return sort.direction === "asc" ? compared : -compared
    })
  }, [body, sort])
  if (!head) return null
  return (
    <ScrollView horizontal style={styles.block} showsHorizontalScrollIndicator={false}>
      <View>
        <View style={[styles.row, { borderBottomColor: theme.colors.line }]}>
          {head.children.map((cell, column) => {
            const direction = sort?.column === column ? sort.direction : null
            const label = plain(cell.children) || `column ${column + 1}`
            return (
              <Pressable key={column} accessibilityRole="button" accessibilityLabel={`Sort by ${label}`} onPress={() => setSort((current) => nextSort(current, column))} style={styles.cell}>
                <Text variant="ui" weight="semibold" tone={look.tone}>
                  <Inline nodes={cell.children} look={look} />
                  {direction === "asc" ? " ↑" : direction === "desc" ? " ↓" : ""}
                </Text>
              </Pressable>
            )
          })}
        </View>
        {rows.map(({ row, index }) => (
          <View key={index} testID={`row-${index}`} style={[styles.row, { borderBottomColor: theme.colors.line }]}>
            {head.children.map((_, column) => (
              <View key={column} style={styles.cell}>
                <Text variant="ui" tone={look.tone}>
                  <Inline nodes={row.children[column]?.children ?? []} look={look} />
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

function Blocks({ nodes, look }: { nodes: readonly RootContent[]; look: Look }): ReactNode {
  const theme = useTheme()
  return nodes.map((node, index) => {
    switch (node.type) {
      case "paragraph":
        return (
          <Text key={index} tone={look.tone} style={styles.paragraph}>
            <Inline nodes={node.children} look={look} />
          </Text>
        )
      case "heading":
        return (
          <Text key={index} variant={node.depth <= 2 ? "title" : "ui"} weight="semibold" tone={look.tone} style={styles.paragraph}>
            <Inline nodes={node.children} look={look} />
          </Text>
        )
      case "code":
        return <CodeBlock key={index} node={node} />
      case "blockquote":
        return (
          <View key={index} style={[styles.quote, { borderLeftColor: theme.colors.edgeStrong }]}>
            <Blocks nodes={node.children} look={{ tone: "ink2" }} />
          </View>
        )
      case "list":
        return (
          <View key={index} style={styles.block}>
            {node.children.map((item, i) => {
              const mark = item.checked === true ? "☑" : item.checked === false ? "☐" : node.ordered ? `${(node.start ?? 1) + i}.` : "•"
              return (
                <View key={i} style={styles.item}>
                  <Text tone={look.tone} numbers style={styles.mark}>
                    {mark}
                  </Text>
                  <View style={styles.itemBody}>
                    <Blocks nodes={item.children} look={look} />
                  </View>
                </View>
              )
            })}
          </View>
        )
      case "table":
        return <MarkdownTable key={index} node={node} look={look} />
      case "thematicBreak":
        return <View key={index} style={[styles.rule, { backgroundColor: theme.colors.line }]} />
      case "html":
        return null
      default:
        return null
    }
  })
}

export const Markdown = memo(function Markdown({ children, tone = "ink" }: { children: string; tone?: Tone }) {
  const tree = useMemo(() => parseMarkdown(children), [children])
  return (
    <View>
      <Blocks nodes={tree.children} look={{ tone }} />
    </View>
  )
})

const styles = StyleSheet.create({
  paragraph: { marginVertical: 2 },
  italic: { fontStyle: "italic" },
  struck: { textDecorationLine: "line-through" },
  block: { marginVertical: 6 },
  codeScroll: { paddingHorizontal: 12, paddingVertical: 10, paddingRight: 56 },
  copy: { position: "absolute", top: 4, right: 8, padding: 4 },
  quote: { borderLeftWidth: 3, paddingLeft: 10, marginVertical: 4 },
  item: { flexDirection: "row", gap: 6 },
  mark: { minWidth: 18, textAlign: "right" },
  itemBody: { flex: 1 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  row: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { minWidth: 72, paddingVertical: 4, paddingRight: 16 },
})
