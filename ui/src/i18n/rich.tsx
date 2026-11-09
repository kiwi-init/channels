import { Fragment, type ReactNode } from "react"

import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"

const MARK = "\u0000"

export function tr(key: Key, parts: Readonly<Record<string, ReactNode>>): ReactNode {
  const vars: Record<string, string | number> = {}
  for (const [name, part] of Object.entries(parts)) vars[name] = name === "count" && typeof part === "number" ? part : `${MARK}${name}${MARK}`
  const pieces = t(key, vars).split(new RegExp(`${MARK}(\\w+)${MARK}`))
  return pieces.map((piece, i) => <Fragment key={i}>{i % 2 ? parts[piece] : piece}</Fragment>)
}
