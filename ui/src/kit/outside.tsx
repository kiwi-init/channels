import type { ComponentProps, MouseEvent } from "react"

import { bridge, type KiwiBridge } from "@kiwi/secrets/secrets.ts"

type Opener = Pick<KiwiBridge, "openExternal">

const OUTSIDE = /^(?:https?:\/\/|mailto:)/i

function isOutside(url: string): boolean {
  return OUTSIDE.test(url.trim())
}

export function openOutside(url: string, onFail: () => void = () => {}, via: Opener | null = bridge()): void {
  if (!isOutside(url)) return
  if (via) void via.openExternal(url).catch(onFail)
  else window.open(url, "_blank", "noopener,noreferrer")
}

type LinkProps = Omit<ComponentProps<"a">, "href" | "target" | "rel" | "onClick"> & { href: string }

export function OutsideLink({ href, children, ...rest }: LinkProps) {
  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    openOutside(href)
  }
  return (
    <a {...rest} href={href} rel="noreferrer noopener" onClick={open}>
      {children}
    </a>
  )
}
