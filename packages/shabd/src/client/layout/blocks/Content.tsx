import { usePage } from '../../app/router.js'

/**
 * The compiled Markdown/MDX body. Components come from virtual:shabd/mdx-components.
 *
 * The page's code colours come with it as a small stylesheet, one class per
 * colour a token can have. It sits beside the article, not inside it, so it
 * is never the article's first or last child.
 */
export function Content() {
  const { Content: Body, codeCss } = usePage()
  return (
    <>
      {codeCss && <style data-sb-code="">{codeCss}</style>}
      <article className="sb-content">
        <Body />
      </article>
    </>
  )
}
