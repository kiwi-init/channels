const WORDS: Record<string, string> = {
  panel: "A panel beside the chat",
  sidebar: "A section in the sidebar",
  tab: "A tab in the channel's header",
  github: "Sees this channel's repos, PRs and issues",
  command: "Commands in ⌘K",
  "message-action": "Items in a message's menu, which send it that message when you pick one",
  terminal: "Show your agents' terminals and mark the ones that need you",
  idle: "Covers the whole window while you're away; a key or a click brings the app back",
  channels: "Sees every channel's name, how many need you, and its last line",
}

const roomWords = (need: string): string | null => {
  const room = need.replace(/^(post|read):#?/, "")
  if (need.startsWith("post:")) return `Post in #${room} of the channels you tick, as you, with a line saying it came from this mod`
  if (need.startsWith("read:")) return `Read #${room} of the channels you tick`
  return null
}

export const needWords = (need: string): string =>
  need.startsWith("net:") ? `Talk to ${need.slice(4)}` : need.startsWith("render:") ? `Draw ${need.slice(7)} attachments in chat, live` : (roomWords(need) ?? WORDS[need] ?? need)
