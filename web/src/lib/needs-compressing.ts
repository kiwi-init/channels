export function needsCompressing(file: { size: number; type: string }, limit: number): boolean {
  return file.size > limit && file.type !== "image/gif"
}
