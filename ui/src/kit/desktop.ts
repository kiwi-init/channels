import { startGlass } from "~/kit/glass"
import { quietNativeMenu } from "~/kit/native-menu"

export function bootDesktop(): void {
  quietNativeMenu()
  startGlass()
}
