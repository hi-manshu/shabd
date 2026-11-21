/**
 * A diagram, drawn in the reader's browser from a ```` ```mermaid ```` fence.
 *
 * Mermaid measures text to lay a diagram out, which needs a browser, so the
 * drawing cannot be done when the site is built. The page carries the
 * diagram's source; this component swaps it for the drawing once Mermaid has
 * loaded. Mermaid is large, and is fetched only by a page that has a diagram.
 *
 * A diagram is drawn in the site's colours, read from the theme's tokens,
 * and drawn again when the reader changes colour mode or palette.
 */
import { useEffect, useId, useState, useSyncExternalStore } from 'react'

/** Which colours the page is in: the colour mode and the palette, as the root element has them. */
function subscribeToColours(notify: () => void): () => void {
  const observer = new MutationObserver(notify)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] })
  return () => observer.disconnect()
}
const coloursNow = () => `${document.documentElement.dataset.theme ?? ''}/${document.documentElement.dataset.palette ?? ''}`

/**
 * A colour as Mermaid takes one. Its theme only reads hex, and a token may be
 * written any way CSS allows. A canvas gives back whatever it is handed as
 * hex, or as `rgba()` when it is see-through, in which case the token is
 * left to Mermaid's own default.
 */
function hex(colour: string, canvas: CanvasRenderingContext2D | null): string | undefined {
  if (!colour || !canvas) return undefined
  canvas.fillStyle = '#000000'
  canvas.fillStyle = colour
  const read = canvas.fillStyle
  return typeof read === 'string' && /^#[0-9a-f]{6}$/i.test(read) ? read : undefined
}

/** The theme's tokens as the variables Mermaid's `base` theme works every other colour out from. */
function themeVariables(): Record<string, string> {
  const style = getComputedStyle(document.documentElement)
  const canvas = document.createElement('canvas').getContext('2d')
  const token = (name: string) => hex(style.getPropertyValue(`--sb-${name}`).trim(), canvas)
  const variables: Record<string, string | undefined> = {
    background: token('background'),
    primaryColor: token('surface'),
    primaryTextColor: token('text'),
    primaryBorderColor: token('muted'),
    secondaryColor: token('surface'),
    secondaryTextColor: token('text'),
    secondaryBorderColor: token('border'),
    tertiaryColor: token('background'),
    tertiaryTextColor: token('text'),
    tertiaryBorderColor: token('border'),
    lineColor: token('muted'),
    textColor: token('text'),
    mainBkg: token('surface'),
    nodeBorder: token('muted'),
    clusterBkg: token('background'),
    clusterBorder: token('border'),
    titleColor: token('text'),
    edgeLabelBackground: token('background'),
    noteBkgColor: token('surface'),
    noteTextColor: token('text'),
    noteBorderColor: token('border'),
    fontFamily: style.getPropertyValue('--sb-font-sans').trim() || undefined,
  }
  return Object.fromEntries(Object.entries(variables).filter((entry): entry is [string, string] => entry[1] !== undefined))
}

type Drawing = { svg: string } | { problem: string } | null

export default function Mermaid({ code }: { code: string }) {
  // Mermaid uses the id as an element id and in CSS selectors, where React's `:r1:` would not do.
  const id = `sb-mermaid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const colours = useSyncExternalStore(subscribeToColours, coloursNow, () => '')
  const [drawing, setDrawing] = useState<Drawing>(null)

  useEffect(() => {
    let current = true
    void (async () => {
      try {
        const { default: mermaid } = await import('virtual:shabd/mermaid')
        if (!mermaid) throw new Error('Diagrams need the mermaid package, which this site does not have installed.')
        // `strict` is Mermaid's own setting for text it did not write: no scripts, no click handlers, labels as text.
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: themeVariables() })
        const { svg } = await mermaid.render(id, code)
        if (current) setDrawing({ svg })
      } catch (error) {
        // Mermaid leaves a picture of its error in the page when it cannot read a diagram. The message is enough.
        document.getElementById(`d${id}`)?.remove()
        document.getElementById(id)?.remove()
        if (current) setDrawing({ problem: error instanceof Error ? error.message : String(error) })
      }
    })()
    return () => {
      current = false
    }
  }, [code, colours, id])

  if (drawing && 'svg' in drawing) {
    // The markup is Mermaid's own output, made under its `strict` setting from the page's own source.
    return <figure className="sb-mermaid" dangerouslySetInnerHTML={{ __html: drawing.svg }} />
  }
  return (
    <figure className="sb-mermaid" data-pending={drawing ? undefined : ''}>
      <pre className="sb-mermaid-source">
        <code>{code}</code>
      </pre>
      {drawing && (
        <pre className="sb-mermaid-problem" role="alert">
          {drawing.problem}
        </pre>
      )}
    </figure>
  )
}
