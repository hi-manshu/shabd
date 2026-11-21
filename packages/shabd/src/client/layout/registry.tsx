/**
 * Block name → component. The names are the vocabulary of `layouts:` in
 * shabd.config.yaml; `Record<BuiltinBlockName, …>` makes the compiler insist
 * that every name the config validator accepts has an implementation here.
 */
import type { ComponentType } from 'react'
import { customBlocks } from 'virtual:shabd/blocks'
import type { BuiltinBlockName } from '../../shared/blocks.js'
import { ApiEndpoint } from './blocks/ApiEndpoint.js'
import { Breadcrumbs } from './blocks/Breadcrumbs.js'
import { Content } from './blocks/Content.js'
import { Footer } from './blocks/Footer.js'
import {
  MenuToggle,
  Nav,
  SearchButton,
  SiteTitle,
  Social,
  Spacer,
  StudioToggle,
  ThemeMenu,
  ThemeToggle,
} from './blocks/Header.js'
import { Hero } from './blocks/Hero.js'
import { PageActions } from './blocks/PageActions.js'
import { PageFooter } from './blocks/PageFooter.js'
import { PageHeader } from './blocks/PageHeader.js'
import { Pagination } from './blocks/Pagination.js'
import { SidebarNav } from './blocks/SidebarNav.js'
import { Toc } from './blocks/Toc.js'

// Blocks take whatever `props:` the YAML gives them, so the registry is loosely typed on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = ComponentType<any>

const builtinBlocks: Record<BuiltinBlockName, AnyBlock> = {
  'menu-toggle': MenuToggle,
  'site-title': SiteTitle,
  nav: Nav,
  spacer: Spacer,
  search: SearchButton,
  social: Social,
  'theme-toggle': ThemeToggle,
  'theme-menu': ThemeMenu,
  'studio-toggle': StudioToggle,
  'sidebar-nav': SidebarNav,
  breadcrumbs: Breadcrumbs,
  'page-header': PageHeader,
  'page-actions': PageActions,
  'api-endpoint': ApiEndpoint,
  hero: Hero,
  content: Content,
  'page-footer': PageFooter,
  pagination: Pagination,
  toc: Toc,
  footer: Footer,
}

/** Custom blocks may replace built-ins of the same name. */
export const blockRegistry: Record<string, AnyBlock> = { ...builtinBlocks, ...customBlocks }
