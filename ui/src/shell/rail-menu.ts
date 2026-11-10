import "~/i18n/en/shell-later"

import type { OpenMenu } from "~/kit/menu-open"
import type { Folder } from "~/model"
import { dropOn, folderName, newFolderId, renamed, ungrouped } from "~/shell/folders"
import { t } from "~/i18n/i18n"

export type RailTarget = { kind: "folder"; id: string } | { kind: "channel"; code: string }

interface Rail {
  folders: readonly Folder[]
  title: (code: string) => string
  muted: (code: string) => boolean
  setMute: (code: string, on: boolean) => void
  save: (folders: Folder[]) => void
  settings: ((code: string) => void) | null
}

export function railMenu(target: RailTarget, at: { x: number; y: number }, rail: Rail): OpenMenu | null {
  const { folders, save } = rail
  if (target.kind === "folder") {
    const folder = folders.find((f) => f.id === target.id)
    if (!folder) return null
    return {
      ...at,
      label: t("shell.rail.menu.folder.named", { name: folder.name }),
      field: { label: t("shell.rail.menu.folder.name"), value: folder.name, max: 40, save: (name) => save(renamed(folders, folder.id, name)) },
      groups: [[{ label: t("shell.rail.menu.ungroup"), run: () => save(ungrouped(folders, folder.id)) }]],
    }
  }
  const { code } = target
  const muted = rail.muted(code)
  const holder = folders.find((f) => f.codes.includes(code))
  return {
    ...at,
    label: rail.title(code),
    groups: [
      [
        { label: muted ? t("shell.rail.menu.unmute") : t("shell.rail.menu.mute"), run: () => rail.setMute(code, !muted) },
        ...(holder
          ? [{ label: t("shell.rail.menu.take.out", { name: holder.name }), run: () => save(dropOn(folders, code, { kind: "rail" }, newFolderId)) }]
          : [
              ...folders.map((f) => ({ label: t("shell.rail.menu.add.to", { name: f.name }), run: () => save(dropOn(folders, code, { kind: "folder", id: f.id }, newFolderId)) })),
              { label: t("shell.rail.menu.new.folder"), run: () => save([...folders, { id: newFolderId(), name: folderName(), codes: [code], open: true }]) },
            ]),
      ],
      ...(rail.settings ? [[{ label: t("shell.channel.settings"), run: () => rail.settings?.(code) }]] : []),
    ],
  }
}
