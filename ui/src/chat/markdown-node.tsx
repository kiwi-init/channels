import { createElement, useId, useState } from "react"
import { blockRenderers } from "react-native-enriched-markdown/lib/module/web/renderers/BlockRenderers.js"
import { inlineRenderers } from "react-native-enriched-markdown/lib/module/web/renderers/InlineRenderers.js"
import { listRenderers } from "react-native-enriched-markdown/lib/module/web/renderers/ListRenderers.js"
import { tableRenderers } from "react-native-enriched-markdown/lib/module/web/renderers/TableRenderers.js"
import { extractNodeText, hasStrongText } from "react-native-enriched-markdown/lib/module/web/utils.js"
import type { ASTNode, RendererProps } from "react-native-enriched-markdown/lib/typescript/src/web/types"
import { t } from "~/i18n/i18n.ts"

const RENDERERS = new Map(Object.entries({ ...blockRenderers, ...inlineRenderers, ...listRenderers, ...tableRenderers }))
const LinkRenderer = inlineRenderers.Link

function taskMetadata(node: ASTNode) {
  const originals = new WeakMap<ASTNode, ASTNode>()
  const withoutSpoilers = (current: ASTNode): ASTNode => {
    const next = current.type === "Spoiler" ? { ...current, content: "", children: [] } : { ...current, ...(current.children ? { children: current.children.map(withoutSpoilers) } : {}) }
    originals.set(next, current)
    return next
  }
  return { node: withoutSpoilers(node), original: (current: ASTNode) => originals.get(current) ?? current }
}

function tablePart(node: ASTNode): boolean {
  switch (node.type) {
    case "Table":
    case "TableHead":
    case "TableBody":
    case "TableRow":
      return true
    default:
      return false
  }
}

type Props = Omit<RendererProps, "renderChildren"> & { link?: ASTNode }

export const hasSpoiler = (node: ASTNode): boolean => node.type === "Spoiler" || !!node.children?.some(hasSpoiler)

function Spoiler({ renderChildren, node }: RendererProps) {
  const [shown, setShown] = useState(false)
  const id = useId()
  const label = t(shown ? "chat.markdown.spoiler.hide" : "chat.markdown.spoiler.show")
  return (
    <span className="md-spoiler">
      <button
        type="button"
        className="md-spoiler-toggle"
        aria-label={label}
        aria-expanded={shown}
        aria-controls={id}
        data-label={label}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.focus()
          setShown(!shown)
        }}
      />
      <span id={id} hidden={!shown}>
        {shown && renderChildren(node)}
      </span>
    </span>
  )
}

const nodeKey = (node: ASTNode, index: number) =>
  node.attributes?.blockSlotId ?? (node.type === "ListItem" && node.attributes?.isTask === "true" ? `task-${node.attributes.taskIndex ?? index}-${node.attributes.taskChecked}` : index)

export function MarkdownNode({ node, style, styles, callbacks, capabilities, parentType, index, link }: Props) {
  const ownCapabilities = capabilities.blockDir && !hasStrongText(node) ? { ...capabilities, blockDir: undefined } : capabilities
  const childCapabilities = ownCapabilities.blockDir && !tablePart(node) ? { ...ownCapabilities, blockDir: undefined } : ownCapabilities
  const splitLink = node.type === "Link" && hasSpoiler(node)
  const childLink = node.type === "Link" ? (splitLink ? node : undefined) : link
  const task = node.type === "ListItem" && node.attributes?.isTask === "true" && hasSpoiler(node) ? taskMetadata(node) : undefined
  const renderChildren = (parent: ASTNode) =>
    parent.children?.map((child, i) => {
      const original = task?.original(child) ?? child
      return (
        <MarkdownNode
          key={nodeKey(original, i)}
          node={original}
          style={style}
          styles={styles}
          callbacks={callbacks}
          capabilities={childCapabilities}
          parentType={parent.type}
          index={i}
          link={childLink}
        />
      )
    }) ?? null
  const ownCallbacks: RendererProps["callbacks"] =
    task && callbacks.onTaskListItemPress
      ? {
          ...callbacks,
          onTaskListItemPress: (event) => callbacks.onTaskListItemPress?.({ ...event, text: extractNodeText(node) }),
        }
      : callbacks
  const props = { node: task?.node ?? node, style, styles, callbacks: ownCallbacks, capabilities: ownCapabilities, parentType, index, renderChildren }
  if (node.type === "Spoiler") return <Spoiler {...props} />
  if (splitLink) return <>{renderChildren(node)}</>
  const Renderer = RENDERERS.get(node.type)
  if (node.type === "Image" && hasSpoiler(node) && Renderer) return <Spoiler {...props} renderChildren={() => createElement(Renderer, props)} />
  const content = Renderer ? (
    createElement(Renderer, props)
  ) : (
    <>
      {node.content && <MarkdownNode {...props} node={{ type: "Text", content: node.content }} link={link} />}
      {renderChildren(node)}
    </>
  )
  return link && LinkRenderer && !node.children?.length && Renderer ? createElement(LinkRenderer, { ...props, node: link, renderChildren: () => content }) : content
}
