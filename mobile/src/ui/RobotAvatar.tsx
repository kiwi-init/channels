import { SvgXml } from "react-native-svg"

import { avatarIndex } from "./avatarIndex"
import { robots } from "./robots"

export interface RobotAvatarProps {
  name: string
  size?: number
  label?: string
}

export function RobotAvatar({ name, size = 28, label }: RobotAvatarProps) {
  const xml = robots[avatarIndex(name, robots.length)] ?? ""
  return <SvgXml xml={xml} width={size} height={size} accessible={!!label} accessibilityRole={label ? "image" : undefined} accessibilityLabel={label} />
}
