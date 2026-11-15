import { usePage } from '../../app/router.js'

/** The compiled Markdown/MDX body. Components come from virtual:shabd/mdx-components. */
export function Content() {
  const { Content: Body } = usePage()
  return (
    <article className="sb-content">
      <Body />
    </article>
  )
}
