import { usePage } from '../../app/router.js'
import { Badge } from '../../ui/Badge.js'

const PARAMETER = /(\{[^}]+\}|:[A-Za-z_]\w*)/

/** The request line of an API page, from `api:` frontmatter. */
export function ApiEndpoint() {
  const { api } = usePage().frontmatter
  if (!api) return null
  return (
    <div className="sb-api-endpoint" data-method={api.method}>
      <p className="sb-api-request">
        <span className="sb-api-method">{api.method}</span>
        <code className="sb-api-path">
          {api.baseUrl && <span className="sb-api-base">{api.baseUrl}</span>}
          {api.path.split(PARAMETER).map((part, index) =>
            PARAMETER.test(part) ? (
              <span key={index} className="sb-api-param">
                {part}
              </span>
            ) : (
              part
            ),
          )}
        </code>
        {api.deprecated && <Badge text="Deprecated" variant="danger" />}
      </p>
      {api.auth && (
        <p className="sb-api-auth">
          Authentication: <strong>{api.auth}</strong>
        </p>
      )}
    </div>
  )
}
