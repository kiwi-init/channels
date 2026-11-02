import type { CSSProperties } from "react"

import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { ChannelTile, Folder } from "~/model"
import { folderNews } from "~/shell/folders"
import { Face } from "~/shell/rail"

export default function FolderTile({
  folder,
  tiles,
  on,
  onClick,
  drop,
  fresh,
}: {
  folder: Folder
  tiles: readonly ChannelTile[]
  on: string | null
  drop: boolean
  fresh: boolean
  onClick: () => void
}) {
  const news = folderNews(tiles, on)
  const shut = !folder.open
  const label = [`${folder.name} folder`, `${tiles.length} channels`, news.needsYou ? `${news.needsYou} need you` : "", news.unread ? "new messages" : "", shut ? "closed" : "open"]
    .filter(Boolean)
    .join(", ")
  return (
    <button
      type="button"
      className={cx("tile is-folder", shut && news.holdsOn && "is-on", drop && "is-drop", fresh && "is-new")}
      aria-expanded={folder.open}
      aria-label={label}
      title={folder.name}
      data-folder={folder.id}
      onClick={onClick}
    >
      {shut ? (
        <span className="folder-grid" aria-hidden="true">
          {tiles.slice(0, 4).map((t, i) => (
            <span key={t.code} className="folder-mini" style={{ "--i": i } as CSSProperties}>
              <Face tile={t} />
            </span>
          ))}
        </span>
      ) : (
        <Icon name="folder" size={16} />
      )}
      {shut && (news.needsYou > 0 ? <span className="tile-badge">{news.needsYou}</span> : news.unread && !news.holdsOn ? <span className="tile-dot" /> : null)}
    </button>
  )
}
