import { Fragment, type ReactNode } from "react"

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(@[\w.-]+)|(https?:\/\/[^\s)]+)|(\bT\d+\b)|(#\d+\b)/g

function Inline({ text, names, onTask }: { text: string; names: Set<string>; onTask?: (id: number) => void }) {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const [whole, code, bold, mention, url, task] = m
    if (code) out.push(<code key={at}>{code.slice(1, -1)}</code>)
    else if (bold) out.push(<strong key={at}>{bold.slice(2, -2)}</strong>)
    else if (mention)
      out.push(
        names.has(mention.slice(1).toLowerCase()) ? (
          <span key={at} className="mention">
            {mention}
          </span>
        ) : (
          mention
        )
      )
    else if (url)
      out.push(
        <a key={at} href={url} target="_blank" rel="noreferrer noopener">
          {url.replace(/^https?:\/\/(www\.)?/, "")}
        </a>
      )
    else if (task && onTask)
      out.push(
        <button key={at} type="button" className="ref" onClick={() => onTask(Number(task.slice(1)))}>
          {task}
        </button>
      )
    else out.push(whole)
    last = at + whole.length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}

export function Text({ text, names, onTask }: { text: string; names: Set<string>; onTask?: (id: number) => void }) {
  const blocks = text.split(/```/)
  return (
    <div className="text">
      {blocks.map((block, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="text-code">
            <code>{block.replace(/^\w*\n/, "")}</code>
          </pre>
        ) : (
          <Fragment key={i}>
            {block
              .trim()
              .split(/\n{2,}/)
              .filter(Boolean)
              .map((para, j) => {
                const lines = para.split("\n")
                if (lines.every((l) => /^\s*[-*] /.test(l)))
                  return (
                    <ul key={j}>
                      {lines.map((l, k) => (
                        <li key={k}>
                          <Inline text={l.replace(/^\s*[-*] /, "")} names={names} onTask={onTask} />
                        </li>
                      ))}
                    </ul>
                  )
                if (lines.every((l) => /^\s*\d+\. /.test(l)))
                  return (
                    <ol key={j}>
                      {lines.map((l, k) => (
                        <li key={k}>
                          <Inline text={l.replace(/^\s*\d+\. /, "")} names={names} onTask={onTask} />
                        </li>
                      ))}
                    </ol>
                  )
                return (
                  <p key={j}>
                    {lines.map((l, k) => (
                      <Fragment key={k}>
                        {k > 0 && <br />}
                        <Inline text={l} names={names} onTask={onTask} />
                      </Fragment>
                    ))}
                  </p>
                )
              })}
          </Fragment>
        )
      )}
    </div>
  )
}
