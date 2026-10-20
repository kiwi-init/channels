export interface DraftFile {
  name: string
  mime: string
  data: string
}

export interface Draft {
  body: string
  files: DraftFile[]
}

const drafts = new Map<string, Draft>()

export function draftOf(key: string | undefined): Draft | undefined {
  return key ? drafts.get(key) : undefined
}

export function keepDraft(key: string | undefined, draft: Draft): void {
  if (!key) return
  if (draft.body || draft.files.length) drafts.set(key, draft)
  else drafts.delete(key)
}
