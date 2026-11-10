export const CHANNEL_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

type ChannelKey = (typeof CHANNEL_KEYS)[number];

export type UiCommand = "settings" | "new-channel" | "find" | "jump" | "back" | "forward" | "sidebar" | `channel-${ChannelKey}`;

export const UI_COMMANDS: readonly UiCommand[] = ["settings", "new-channel", "find", "jump", "back", "forward", "sidebar", ...CHANNEL_KEYS.map((n): UiCommand => `channel-${n}`)];
