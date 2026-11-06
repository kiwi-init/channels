import { bridge } from "@kiwi/secrets/secrets.ts"

export const modsServed = (): boolean => typeof bridge()?.mods === "function"
