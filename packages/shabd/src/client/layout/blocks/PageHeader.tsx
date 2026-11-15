import { usePage } from '../../app/router.js'
import { Badge } from '../../ui/Badge.js'

/** Title, header badges and description, all from frontmatter. */
export function PageHeader() {
  const { title, description, frontmatter } = usePage()
  return (
    <header className="sb-page-header">
      <div className="sb-page-title-row">
        <h1 className="sb-page-title">{title}</h1>
        {frontmatter.badges.length > 0 && (
          <p className="sb-page-badges">
            {frontmatter.badges.map((badge) => (
              <Badge key={badge.text} {...badge} />
            ))}
          </p>
        )}
      </div>
      {description && <p className="sb-page-description">{description}</p>}
    </header>
  )
}
