export const WINDOW_SIZE = { width: 1200, height: 800, minHeight: 480 } as const;

export const TRAFFIC_LIGHTS = { x: 20, y: 20 } as const;

export const windowBackground = (dark: boolean): string => (dark ? "#000000" : "#f2f2f5");
