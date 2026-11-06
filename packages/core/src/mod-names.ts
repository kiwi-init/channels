export const APP_PREFIXES = ["app", "nav", "view", "chat", "debug"] as const;

export const isAppPrefix = (name: string): boolean => (APP_PREFIXES as readonly string[]).includes(name);
