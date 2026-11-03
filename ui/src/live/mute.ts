export const muteKey = (code: string, room?: string | null): string => (room ? `${code}/${room}` : code)

export const isMuted = (muted: readonly string[], code: string, room?: string | null): boolean => muted.includes(code) || (!!room && muted.includes(`${code}/${room}`))
