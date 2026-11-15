import type { ComponentType } from 'react'
import type { PageExports } from '../../shared/types.js'

/** A compiled .md/.mdx file as the router sees it. */
export interface PageModule extends PageExports {
  default: ComponentType<Record<string, unknown>>
}

/** A route resolved to its module. `module` is null when no page matches the path. */
export interface LoadedPage {
  path: string
  module: PageModule | null
}
