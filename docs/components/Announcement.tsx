import { useSite } from '@himanshoe/shabd/client'

/**
 * A custom layout block. It is registered under `blocks:` in shabd.config.yaml
 * and placed in the `banner` region of the `base` layout.
 *
 * Blocks read the site and the current page through hooks from `@himanshoe/shabd/client`,
 * and receive whatever `props:` the layout gives them.
 */
export default function Announcement({ message }: { message?: string }) {
  const { site } = useSite()
  return (
    <p className="announcement">
      {message ?? `${site.title} is pre-release software. Configuration keys may change before 1.0.`}
    </p>
  )
}
