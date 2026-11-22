import { useText } from '../../app/edition.js'
import { Icon } from '../../app/icons.js'
import { usePage } from '../../app/router.js'
import { useSite } from '../../app/store.js'

/**
 * What a reader may want to know at the end of a page: where to change it
 * ("Edit this page", linking to the file in the repository named in the
 * config) and when it was last changed. Either can be missing; with neither,
 * the block draws nothing.
 */
export function PageFooter() {
  const { site, defaults, contentDir } = useSite()
  const { id, frontmatter, updated } = usePage()
  const text = useText()
  const repo = site.repo
  const editable = repo && id && (frontmatter.editLink ?? defaults.editLink)
  if (!editable && !updated) return null
  const file = [repo?.dir, contentDir, id].filter(Boolean).join('/')
  return (
    <footer className="sb-page-footer">
      {editable && (
        <a href={`${repo.url.replace(/\/$/, '')}/edit/${repo.branch}/${file}`} target="_blank" rel="noreferrer">
          <Icon name="edit" size={15} />
          {text('page.edit')}
        </a>
      )}
      {updated && (
        <p className="sb-page-updated">
          {`${text('page.updated')} `}
          <time dateTime={updated.day}>{updated.text}</time>
        </p>
      )}
    </footer>
  )
}
