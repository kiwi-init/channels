const WORDS: Record<string, string> = {
  panel: "A panel beside the chat",
  sidebar: "A section in the sidebar",
  command: "Commands in ⌘K",
  "message-action": "Items in a message's menu, which send it that message when you pick one",
  terminal: "Show your agents' terminals and mark the ones that need you",
}

export const needWords = (need: string): string => (need.startsWith("net:") ? `Talk to ${need.slice(4)}` : (WORDS[need] ?? need))
