import { useEffect, useState } from 'react'
import type { TocEntry } from '../../../shared/types.js'
import { useText } from '../../app/edition.js'
import { usePage } from '../../app/router.js'

/** The heading the reader is currently under, tracked on scroll. */
function useActiveHeading(entries: TocEntry[]): string | null {
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    if (entries.length === 0) return
    let frame = 0

    const update = () => {
      frame = 0
      const offset = (Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 80) + 8
      let current: string | null = null
      for (const entry of entries) {
        const heading = document.getElementById(entry.id)
        if (!heading) continue
        if (heading.getBoundingClientRect().top > offset) break
        current = entry.id
      }
      // At the very bottom the last section may be too short to reach the top.
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
      setActive(atBottom ? (entries.at(-1)?.id ?? current) : current)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [entries])

  return active
}

/** "On this page". Depth comes from `toc:` frontmatter, falling back to `defaults.toc` in the config. */
export function Toc({ title }: { title?: string }) {
  const entries = usePage().layout.toc
  const text = useText()
  const active = useActiveHeading(entries)
  if (entries.length === 0) return null
  const shallowest = Math.min(...entries.map((entry) => entry.depth))
  return (
    <div className="sb-toc">
      <p className="sb-toc-title">{title ?? text('toc')}</p>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id} data-indent={entry.depth - shallowest}>
            <a href={`#${entry.id}`} aria-current={active === entry.id ? 'location' : undefined}>
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
