const counts = new Map<string, number>()
const watchers = new Map<string, (visible: boolean) => void>()

export function onPictureSeen(id: string, tell: ((visible: boolean) => void) | null): void {
  if (tell) watchers.set(id, tell)
  else watchers.delete(id)
}

export const pictureVisible = (id: string): boolean => (counts.get(id) ?? 0) > 0

export function seePicture(id: string, visible: boolean): void {
  const was = counts.get(id) ?? 0
  const now = Math.max(0, was + (visible ? 1 : -1))
  if (now) counts.set(id, now)
  else counts.delete(id)
  if (was > 0 !== now > 0) watchers.get(id)?.(now > 0)
}
