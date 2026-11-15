import { useRef, useState, type ComponentProps } from 'react'
import { Icon } from '../app/icons.js'

type PreProps = ComponentProps<'pre'> & {
  'data-lang'?: string
  'data-title'?: string
}

/**
 * A highlighted code block with its label and a copy button.
 *
 * The tokens arrive already coloured from the build (Shiki). Copy reads the
 * text back out of the DOM, so the code is not shipped a second time as a prop.
 */
export function CodeBlock({ children, 'data-title': title, 'data-lang': lang, ...rest }: PreProps) {
  const pre = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    const text = pre.current?.querySelector('code')?.textContent ?? ''
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard access denied: leave the button as it is.
    }
  }

  return (
    <figure className="sb-code" data-lang={lang}>
      <figcaption className="sb-code-bar">
        <span className="sb-code-label" data-kind={title ? 'title' : 'lang'}>
          {title ?? lang}
        </span>
        <button type="button" className="sb-code-copy" onClick={copy} aria-live="polite">
          <Icon name={copied ? 'check' : 'copy'} size={14} />
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </figcaption>
      <pre ref={pre} {...rest}>
        {children}
      </pre>
    </figure>
  )
}
