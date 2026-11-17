/**
 * The component map for Markdown.
 *
 * Every page is compiled to a React component that looks its elements up
 * here: a `## heading` renders <Heading>, a fenced block renders <CodeBlock>,
 * `> [!NOTE]` renders <Callout>. The names in capitals are also available to
 * write directly in .mdx files, with no import.
 *
 * Sites add or replace entries through `components:` in shabd.config.yaml.
 */
import { lazy, Suspense, useSyncExternalStore, type ComponentProps, type ComponentType } from 'react'
import { useSite } from '../app/store.js'
import { Badge } from '../ui/Badge.js'
import { Link, useHref } from '../ui/Link.js'
import { Accordion } from './Accordion.js'
import { Callout } from './Callout.js'
import { Card, CardGrid } from './Card.js'
import { CodeBlock } from './CodeBlock.js'
import { FileTree } from './FileTree.js'
import { heading } from './Heading.js'
import { Steps } from './Steps.js'
import { Tab, Tabs } from './Tabs.js'

/** Wide tables scroll inside their own box instead of stretching the page. */
function Table(props: ComponentProps<'table'>) {
  return (
    <div className="sb-table-scroll" tabIndex={0} role="region" aria-label="Table">
      <table {...props} />
    </div>
  )
}

function Image({ src, alt = '', ...rest }: ComponentProps<'img'>) {
  const href = useHref()
  // Files in `public/` are referenced from the site root and need the base path.
  const resolved = typeof src === 'string' && src.startsWith('/') && !src.startsWith('//') ? href(src) : src
  return <img src={resolved} alt={alt} loading="lazy" decoding="async" {...rest} />
}

// The sandbox brings a compiler with it, so it loads only on pages that use one.
const LazySandbox = lazy(() => import('../sandbox/Sandbox.js'))

const neverChanges = () => () => {}
/** False on the server and during hydration, true afterwards. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    neverChanges,
    () => true,
    () => false,
  )
}

function Sandbox(props: { code: string; lang?: string; title?: string; group?: string }) {
  const { features } = useSite()
  const hydrated = useHydrated()
  const fallback = (
    <pre className="sb-sandbox-fallback">
      <code>{props.code}</code>
    </pre>
  )
  // A sandbox only runs in the browser. The prerendered page carries the code
  // as plain text; rendering the lazy component on the server would leave a
  // suspended boundary in the HTML for React to report during hydration.
  if (!features.sandbox.enabled || !hydrated) return fallback
  return (
    <Suspense fallback={fallback}>
      <LazySandbox {...props} />
    </Suspense>
  )
}

// Mermaid is large, so it loads only on pages that have a diagram.
const LazyMermaid = lazy(() => import('../mermaid/Mermaid.js'))

function Mermaid(props: { code: string }) {
  const hydrated = useHydrated()
  const source = (
    <figure className="sb-mermaid" data-pending="">
      <pre className="sb-mermaid-source">
        <code>{props.code}</code>
      </pre>
    </figure>
  )
  // A diagram is drawn in the browser. The prerendered page carries its source, for the reason a sandbox does.
  if (!hydrated) return source
  return (
    <Suspense fallback={source}>
      <LazyMermaid {...props} />
    </Suspense>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const components: Record<string, ComponentType<any>> = {
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
  h5: heading(5),
  h6: heading(6),
  a: Link,
  pre: CodeBlock,
  table: Table,
  img: Image,
  Callout,
  Sandbox,
  Mermaid,
  Badge,
  Card,
  CardGrid,
  Tabs,
  Tab,
  Steps,
  FileTree,
  Accordion,
}
