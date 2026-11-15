import { Icon } from '../../app/icons.js'
import { usePage } from '../../app/router.js'
import { useSite } from '../../app/store.js'

/** "Edit this page", linking to the file in the repository named in the config. */
export function PageFooter() {
  const { site, defaults, contentDir } = useSite()
  const { id, frontmatter } = usePage()
  const repo = site.repo
  if (!repo || !id || !(frontmatter.editLink ?? defaults.editLink)) return null
  const file = [repo.dir, contentDir, id].filter(Boolean).join('/')
  return (
    <footer className="sb-page-footer">
      <a href={`${repo.url.replace(/\/$/, '')}/edit/${repo.branch}/${file}`} target="_blank" rel="noreferrer">
        <Icon name="edit" size={15} />
        Edit this page
      </a>
    </footer>
  )
}
