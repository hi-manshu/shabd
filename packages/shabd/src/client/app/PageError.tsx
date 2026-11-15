/**
 * Shown in place of a page's content when the page does not compile (dev only).
 * The module that renders it is generated in src/node/markdown/page-module.ts.
 */
interface PageIssue {
  message: string
  /** `file:line:column` */
  where: string
  /** A few lines of the source with a caret under the problem. */
  frame: string
}

export function PageError({ issues }: { issues: PageIssue[] }) {
  return (
    <div className="sb-page-error" role="alert">
      <p className="sb-page-error-title">
        {issues.length === 1 ? 'This page has a problem' : `This page has ${issues.length} problems`}
      </p>
      {issues.map((issue, index) => (
        <div key={index} className="sb-page-error-issue">
          <p className="sb-page-error-where">{issue.where}</p>
          <p className="sb-page-error-message">{issue.message}</p>
          {issue.frame && <pre>{issue.frame}</pre>}
        </div>
      ))}
      <p className="sb-page-error-hint">Fix the file and save it. This page updates by itself.</p>
    </div>
  )
}
