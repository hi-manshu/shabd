import { useState } from 'react'
import { markdownPath, withBase } from '../../../shared/paths.js'
import { Icon } from '../../app/icons.js'
import { usePage } from '../../app/router.js'
import { useSite } from '../../app/store.js'

/** An AI assistant that opens with a prompt in its address. `{prompt}` is replaced by the prompt, encoded. */
export interface Assistant {
  label: string
  url: string
}

/*
 * These are other companies' addresses, and theirs to change. A site that
 * finds one out of date sets `assistants` on the block, or passes an empty
 * list to leave the links out.
 */
const ASSISTANTS: Assistant[] = [
  { label: 'Claude', url: 'https://claude.ai/new?q={prompt}' },
  { label: 'ChatGPT', url: 'https://chatgpt.com/?hints=search&q={prompt}' },
]

const PROMPT = 'Read {url} so that I can ask questions about it.'

interface PageActionsProps {
  /** Show "Copy page". */
  copy?: boolean
  /** Show "View as Markdown". */
  view?: boolean
  /** The assistants to offer "Open in …" for. They need `site.url`, to have an address to be sent to. */
  assistants?: Assistant[]
  /** What the assistant is asked. `{url}` is replaced by the address of the page's Markdown copy. */
  prompt?: string
}

const isAssistant = (value: unknown): value is Assistant =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Assistant).label === 'string' &&
  typeof (value as Assistant).url === 'string'

/**
 * The page for a reader who works with an AI assistant: copy it as Markdown,
 * open the Markdown, or hand its address to an assistant.
 *
 * Every page already has a Markdown copy at its own address with `.md` added
 * (written with llms.txt). This block is the way to it from the page itself.
 */
export function PageActions({ copy = true, view = true, assistants = ASSISTANTS, prompt = PROMPT }: PageActionsProps) {
  const { site, features } = useSite()
  const { path, notFound } = usePage()
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no')
  if (!features.llms.enabled || notFound) return null

  const markdown = withBase(site.base, markdownPath(path))
  // An assistant fetches the page from the network, so it needs the address the site is deployed at.
  const address = site.url ? new URL(markdown, site.url).href : undefined
  const offered = address && Array.isArray(assistants) ? assistants.filter(isAssistant) : []

  const copyPage = async () => {
    const text = fetch(markdown).then((response) => {
      if (!response.ok) throw new Error(`${response.status}`)
      return response.text()
    })
    try {
      try {
        // Safari lets a page write to the clipboard only while it is handling the click, which is over by the
        // time the text has arrived. A clipboard item may be promised its text, and then the click still counts.
        const item = new ClipboardItem({ 'text/plain': text.then((value) => new Blob([value], { type: 'text/plain' })) })
        await navigator.clipboard.write([item])
      } catch {
        await navigator.clipboard.writeText(await text)
      }
      setCopied('yes')
    } catch {
      setCopied('failed')
    }
    window.setTimeout(() => setCopied('no'), 1600)
  }

  if (!copy && !view && offered.length === 0) return null
  return (
    <div className="sb-page-actions" role="group" aria-label="This page for AI assistants">
      {copy && (
        <button type="button" className="sb-page-action" onClick={copyPage} aria-live="polite">
          <Icon name={copied === 'yes' ? 'check' : 'copy'} size={15} />
          <span>{copied === 'yes' ? 'Copied' : copied === 'failed' ? 'Could not copy' : 'Copy page'}</span>
        </button>
      )}
      {view && (
        <a className="sb-page-action" href={markdown} target="_blank" rel="noreferrer">
          <Icon name="page" size={15} />
          View as Markdown
        </a>
      )}
      {offered.map((assistant) => (
        <a
          key={assistant.label}
          className="sb-page-action"
          href={assistant.url.replace('{prompt}', encodeURIComponent(String(prompt).replace('{url}', address!)))}
          target="_blank"
          rel="noreferrer"
        >
          <Icon name="sparkle" size={15} />
          Open in {assistant.label}
        </a>
      ))}
    </div>
  )
}
