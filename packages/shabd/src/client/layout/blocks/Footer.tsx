import { useSiteInLanguage } from '../../app/edition.js'

/** Site-wide footer text, from `site.footer`, or the page's language's own. Renders nothing when unset. */
export function Footer() {
  const { footer } = useSiteInLanguage()
  if (!footer) return null
  return <p className="sb-footer">{footer}</p>
}
