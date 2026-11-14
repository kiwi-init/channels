export {}

declare global {
  interface Window {
    roomCheck: {
      update: (members: string[]) => void
      leave: (name: string, left: boolean) => void
      fail: (on: boolean) => void
      saved: string[][]
    }
  }
}
