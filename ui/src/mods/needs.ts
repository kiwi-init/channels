const WORDS: Record<string, string> = {
  panel: "A panel beside the chat",
  sidebar: "A section in the sidebar",
  command: "Commands in ⌘K",
  "message-action": "Items in a message's menu, which send it that message when you pick one",
}

export const needWords = (need: string): string =>
  need.startsWith("net:") ? `Talk to ${need.slice(4)}` : need.startsWith("render:") ? `Draw ${need.slice(7)} attachments in chat, live` : (WORDS[need] ?? need)
