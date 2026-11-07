export const APP = [
  { id: "app.palette", title: "Find anything", palette: false },
  { id: "app.new-channel", title: "New channel" },
  { id: "app.join", title: "Join with a code" },
  { id: "app.new-mod", title: "New mod" },
  { id: "app.computers", title: "Your computers" },
  { id: "app.settings", title: "Settings" },
  { id: "app.calm", title: "Calm" },
  { id: "view.sidebar", title: "Toggle sidebar" },
  { id: "chat.search", title: "Search this channel" },
  { id: "nav.back", title: "Go back" },
  { id: "nav.forward", title: "Go forward" },
  { id: "nav.next-news", title: "Next channel with news" },
  { id: "nav.previous-news", title: "Previous channel with news" },
  { id: "view.theme-dark", title: "Theme: Dark" },
  { id: "view.theme-light", title: "Theme: Light" },
  { id: "view.theme-system", title: "Theme: System" },
] as const satisfies readonly { id: string; title: string; palette?: false }[]

export type AppCommand = (typeof APP)[number]["id"]
