import type { ChannelIcon } from "@kiwi/core/protocol.ts"

export const iconUrl = (icon: ChannelIcon | null | undefined): string | undefined => (icon?.kind === "image" ? `data:${icon.mime};base64,${icon.data}` : undefined)
