import { useSite } from '../../app/store.js'

/** Site-wide footer text, from `site.footer`. Renders nothing when unset. */
export function Footer() {
  const { site } = useSite()
  if (!site.footer) return null
  return <p className="sb-footer">{site.footer}</p>
}
