import { withBase } from '../../shared/paths.js'
import { useSite } from './store.js'

/** Body of the page shown for a URL that matches no content file. */
export function NotFound() {
  const { site } = useSite()
  return (
    <div className="sb-not-found">
      <p>
        No page lives at this address. It may have been moved or renamed. Try the search, or start again from the{' '}
        <a href={withBase(site.base, '/')}>home page</a>.
      </p>
    </div>
  )
}
