export const WINDOW_SIZE = { width: 1200, height: 800, minHeight: 480 } as const;

export const TRAFFIC_LIGHTS = { x: 16, y: 18 } as const;

export const windowBackground = (dark: boolean): string => (dark ? "#111113" : "#f2f2f5");
