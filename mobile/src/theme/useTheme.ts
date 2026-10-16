import { useColorScheme } from "react-native"

import { dark, light, mono, radius, shadowPop, type, type Colors, type Scheme } from "./tokens"

export interface Theme {
  scheme: Scheme
  colors: Colors
  type: typeof type
  radius: typeof radius
  shadow: (typeof shadowPop)[Scheme]
  mono: string
}

export function themeFor(scheme: Scheme): Theme {
  return { scheme, colors: scheme === "dark" ? dark : light, type, radius, shadow: shadowPop[scheme], mono }
}

export function useTheme(): Theme {
  return themeFor(useColorScheme() === "dark" ? "dark" : "light")
}
