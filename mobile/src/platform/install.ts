import structuredCloneShim from "@ungap/structured-clone"
import { install } from "react-native-quick-crypto"

install()

if (typeof globalThis.structuredClone !== "function") {
  Object.defineProperty(globalThis, "structuredClone", { value: structuredCloneShim, configurable: true, writable: true })
}
