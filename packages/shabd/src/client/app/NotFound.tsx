import { useHref } from '../ui/href.js'
import { usePlace, useText } from './edition.js'

/** Body of the page shown for a URL that matches no content file. */
export function NotFound() {
  const href = useHref()
  const text = useText()
  const { language } = usePlace()
  // The sentence has a link in it, where it says `{home}`: to where the reader's language starts.
  const [before, after = ''] = text('notFound.text').split('{home}')
  return (
    <div className="sb-not-found">
      <p>
        {before}
        <a href={href(language?.prefix || '/')}>{text('notFound.home')}</a>
        {after}
      </p>
    </div>
  )
}
