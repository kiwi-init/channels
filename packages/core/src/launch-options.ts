const PERMISSIONS = ["default", "accept-edits", "plan", "bypass"] as const;

export type Permission = (typeof PERMISSIONS)[number];
