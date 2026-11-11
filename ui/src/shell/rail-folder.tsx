import "~/i18n/en/shell-later"
import type { CSSProperties } from "react"

import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { ChannelTile, Folder } from "~/model"
import { folderNews } from "~/shell/folders"
import { Face } from "~/shell/rail"
import { t } from "~/i18n/i18n"

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
  const label = [
    t("shell.rail.folder.named", { name: folder.name }),
    t("shell.rail.folder.channels", { count: tiles.length }),
    news.needsYou ? t("shell.rail.folder.need.you", { count: news.needsYou }) : "",
    news.unread ? t("shell.rail.folder.new.messages") : "",
    shut ? t("shell.rail.folder.closed") : t("shell.rail.folder.open"),
  ]
    .filter(Boolean)
    .join(t("shell.rail.folder.sep"))
  return (
    <button
      type="button"
      className={cx("tile is-folder", shut && news.holdsOn && "is-on", drop && "is-drop", fresh && "is-new")}
      aria-expanded={folder.open}
      aria-label={label}
      data-folder={folder.id}
      onClick={onClick}
    >
      {shut ? (
        <span className="folder-grid" aria-hidden="true">
          {tiles.slice(0, 4).map((mini, i) => (
            <span key={mini.code} className="folder-mini" style={{ "--i": i } as CSSProperties}>
              <Face tile={mini} />
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
