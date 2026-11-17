import { useHref } from '../ui/Link.js'

/** Body of the page shown for a URL that matches no content file. */
export function NotFound() {
  const href = useHref()
  return (
    <div className="sb-not-found">
      <p>
        No page lives at this address. It may have been moved or renamed. Try the search, or start again from the{' '}
        <a href={href('/')}>home page</a>.
      </p>
    </div>
  )
}
