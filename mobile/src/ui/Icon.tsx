import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"

import { useTheme } from "../theme/useTheme"

export type { IconSvgElement }

export interface IconProps {
  icon: IconSvgElement
  size?: number
  strokeWidth?: number
  color?: string
}

export function Icon({ icon, size = 18, strokeWidth = 1.6, color }: IconProps) {
  const theme = useTheme()
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={strokeWidth} color={color ?? theme.colors.ink} />
}
