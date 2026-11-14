import { createElement, useId, useState } from "react"
import { blockRenderers } from "react-native-enriched-markdown/lib/module/web/renderers/BlockRenderers.js"
import { inlineRenderers } from "react-native-enriched-markdown/lib/module/web/renderers/InlineRenderers.js"
import { listRenderers } from "react-native-enriched-markdown/lib/module/web/renderers/ListRenderers.js"
import { tableRenderers } from "react-native-enriched-markdown/lib/module/web/renderers/TableRenderers.js"
import { hasStrongText } from "react-native-enriched-markdown/lib/module/web/utils.js"
import type { ASTNode, RendererProps } from "react-native-enriched-markdown/lib/typescript/src/web/types"
import { t } from "~/i18n/i18n.ts"

const RENDERERS = new Map(Object.entries({ ...blockRenderers, ...inlineRenderers, ...listRenderers, ...tableRenderers }))
const LinkRenderer = inlineRenderers.Link

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
  const renderChildren = (parent: ASTNode) =>
    parent.children?.map((child, i) => (
      <MarkdownNode key={nodeKey(child, i)} node={child} style={style} styles={styles} callbacks={callbacks} capabilities={childCapabilities} parentType={parent.type} index={i} link={childLink} />
    )) ?? null
  const props = { node, style, styles, callbacks, capabilities: ownCapabilities, parentType, index, renderChildren }
  if (node.type === "Spoiler") return <Spoiler {...props} />
  if (splitLink) return <>{renderChildren(node)}</>
  const Renderer = RENDERERS.get(node.type)
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
