import { usePage } from '../../app/router.js'
import { useHref } from '../../ui/href.js'

/** The opening of a `layout: splash` page, from `hero:` frontmatter. */
export function Hero() {
  const { title, description, frontmatter } = usePage()
  const href = useHref()
  const hero = frontmatter.hero
  const tagline = hero?.tagline ?? description
  return (
    <section className="sb-hero">
      <div className="sb-hero-text">
        <h1 className="sb-hero-title">{hero?.title ?? title}</h1>
        {tagline && <p className="sb-hero-tagline">{tagline}</p>}
        {hero && hero.actions.length > 0 && (
          <p className="sb-hero-actions">
            {hero.actions.map((action) => (
              <a key={action.link} className="sb-button" data-variant={action.variant} href={href(action.link)}>
                {action.label}
              </a>
            ))}
          </p>
        )}
      </div>
      {hero?.image && <img className="sb-hero-image" src={href(hero.image)} alt="" />}
    </section>
  )
}
