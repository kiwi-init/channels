export const PLEDGE = "Channels is not a harness"

export const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export const pledged = (typed: string): boolean => same(typed, PLEDGE)
