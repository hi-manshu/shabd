/**
 * Said at the top of a page that is in an older version of the docs: which
 * version it is, and where the current one is. A reader who came by a search
 * or an old link has no other way to know that what they read has moved on.
 */
import { usePlace, useElsewhere, useText } from '../../app/edition.js'
import { Link } from '../../ui/Link.js'

export function VersionNotice() {
  const { version, editions } = usePlace()
  const elsewhere = useElsewhere()
  const text = useText()
  const current = editions.versions?.[0]
  if (!current || !version || version === current) return null
  const there = elsewhere({ version: current })
  return (
    <aside className="sb-version-notice" role="note">
      <p>
        {`${text('version.old', { version: version.label })} `}
        <Link href={there.path}>{text(there.samePage ? 'version.thisPage' : 'version.current', { version: current.label })}</Link>
      </p>
    </aside>
  )
}
