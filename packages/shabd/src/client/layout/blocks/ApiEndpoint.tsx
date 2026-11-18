import { lazy, Suspense, useId, useState } from 'react'
import { pathParts } from '../../../shared/api.js'
import { usePage } from '../../app/router.js'
import { Badge } from '../../ui/Badge.js'

// The form is fetched when a reader opens it. Most readers of an API page only read it.
const ApiTry = lazy(() => import('./ApiTry.js'))

/** The request line of an API page, from `api:` frontmatter, and the form to try the request when the page offers it. */
export function ApiEndpoint() {
  const { path, frontmatter } = usePage()
  const { api } = frontmatter
  const [trying, setTrying] = useState(false)
  const panel = useId()
  if (!api) return null
  return (
    <div className="sb-api-endpoint" data-method={api.method}>
      <p className="sb-api-request">
        <span className="sb-api-method">{api.method}</span>
        <code className="sb-api-path">
          {api.baseUrl && <span className="sb-api-base">{api.baseUrl}</span>}
          {pathParts(api.path).map((part, index) =>
            part.parameter === undefined ? (
              part.text
            ) : (
              <span key={index} className="sb-api-param">
                {part.text}
              </span>
            ),
          )}
        </code>
        {api.deprecated && <Badge text="Deprecated" variant="danger" />}
        {api.try && (
          <button
            type="button"
            className="sb-api-try-toggle"
            aria-expanded={trying}
            aria-controls={panel}
            onClick={() => setTrying((open) => !open)}
          >
            {trying ? 'Close' : 'Try it'}
          </button>
        )}
      </p>
      {api.auth && (
        <p className="sb-api-auth">
          Authentication: <strong>{api.auth}</strong>
        </p>
      )}
      {api.try && (
        <div id={panel} hidden={!trying}>
          {trying && (
            <Suspense fallback={null}>
              {/* A form for each page: what was typed for one request is not left in the form of the next. */}
              <ApiTry key={path} api={api} />
            </Suspense>
          )}
        </div>
      )}
    </div>
  )
}
