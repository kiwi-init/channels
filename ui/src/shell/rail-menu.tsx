import { useEffect, useEffectEvent, useRef, useState } from "react"

import type { Folder } from "~/model"
import { useAct, useApp } from "~/nav"
import { dropOn, FOLDER_NAME, newFolderId, renamed, ungrouped } from "~/shell/folders"

export type Menu = { kind: "folder"; id: string; top: number } | { kind: "channel"; code: string; top: number }

export default function RailMenu({ menu, folders, title, save, close }: { menu: Menu; folders: readonly Folder[]; title: (code: string) => string; save: (f: Folder[]) => void; close: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const { actions } = useAct()
  const { app } = useApp()
  const muted = menu.kind === "channel" && app.prefs.muted.includes(menu.code)
  const folder = menu.kind === "folder" ? folders.find((f) => f.id === menu.id) : undefined
  const [name, setName] = useState(folder?.name ?? "")
  const leave = useEffectEvent((keep: boolean) => {
    if (keep && folder && name.trim() !== folder.name) save(renamed(folders, folder.id, name))
    close()
  })
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !box.current?.contains(e.target)) leave(true)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") leave(false)
    }
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("keydown", key)
    box.current?.querySelector<HTMLElement>("input, button")?.focus()
    return () => {
      window.removeEventListener("pointerdown", away, true)
      window.removeEventListener("keydown", key)
    }
  }, [])
  const act = (next: Folder[]) => {
    save(next)
    close()
  }
  const holder = menu.kind === "channel" ? folders.find((f) => f.codes.includes(menu.code)) : undefined
  return (
    <div ref={box} className="rail-menu" role="menu" aria-label={folder ? `${folder.name} folder` : menu.kind === "channel" ? title(menu.code) : "Folder"} style={{ top: menu.top }}>
      {menu.kind === "folder" && folder && (
        <>
          <form
            className="rail-menu-name"
            onSubmit={(e) => {
              e.preventDefault()
              act(renamed(folders, folder.id, name))
            }}
          >
            <label>
              <span>Folder name</span>
              <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            </label>
          </form>
          <button type="button" role="menuitem" onClick={() => act(ungrouped(folders, folder.id))}>
            Ungroup
          </button>
        </>
      )}
      {menu.kind === "channel" && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            actions.setMute(menu.code, null, !muted)
            close()
          }}
        >
          {muted ? "Unmute channel" : "Mute channel"}
        </button>
      )}
      {menu.kind === "channel" &&
        (holder ? (
          <button type="button" role="menuitem" onClick={() => act(dropOn(folders, menu.code, { kind: "rail" }, newFolderId))}>
            Take out of {holder.name}
          </button>
        ) : (
          <>
            {folders.map((f) => (
              <button key={f.id} type="button" role="menuitem" onClick={() => act(dropOn(folders, menu.code, { kind: "folder", id: f.id }, newFolderId))}>
                Add to {f.name}
              </button>
            ))}
            <button type="button" role="menuitem" onClick={() => act([...folders, { id: newFolderId(), name: FOLDER_NAME, codes: [menu.code], open: true }])}>
              New folder
            </button>
          </>
        ))}
    </div>
  )
}
