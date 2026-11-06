const missing = (): Promise<never> => Promise.reject(new Error("diagrams don't draw inside mods yet"))

export default {
  initialize: (): void => undefined,
  parse: missing,
  render: missing,
}
