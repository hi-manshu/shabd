import { describe, expect, it } from 'vitest'
import { renderDocument } from '../src/node/build/html.js'
import { isShabdError, type ShabdError } from '../src/node/config/errors.js'
import { resolveConfig } from '../src/node/config/load.js'

const load = (yaml: string) => resolveConfig('/site', '/site/shabd.config.yaml', yaml)

function failure(run: () => unknown): ShabdError {
  try {
    run()
  } catch (error) {
    if (isShabdError(error)) return error
    throw error
  }
  throw new Error('expected a ShabdError')
}

const documentFor = (yaml: string, path = '/guide') =>
  renderDocument({ config: load(yaml).config, title: 'Guide', description: '', path })

describe('site.head', () => {
  it('writes the site\'s own tags into the head of the document, after Shabd\'s', () => {
    const html = documentFor(`
site:
  title: Docs
  head:
    - tag: meta
      attrs: { name: google-site-verification, content: abc123 }
    - tag: script
      attrs: { src: https://stats.example/js/script.js, defer: true, async: false, data-domain: docs.example }
    - tag: script
      content: "window.queue = window.queue || []"
    - tag: style
      content: "body { margin: 0 }"
`)
    expect(html).toContain('<meta name="google-site-verification" content="abc123">')
    // `true` is an attribute with no value, `false` is no attribute at all.
    expect(html).toContain('<script src="https://stats.example/js/script.js" defer data-domain="docs.example"></script>')
    expect(html).toContain('<script>window.queue = window.queue || []</script>')
    expect(html).toContain('<style>body { margin: 0 }</style>')
    expect(html.indexOf('google-site-verification')).toBeGreaterThan(html.indexOf('name="generator"'))
    expect(html.indexOf('google-site-verification')).toBeLessThan(html.indexOf('</head>'))
  })

  it('escapes attribute values, and gives a path inside the site its base', () => {
    const html = documentFor(`
site:
  title: Docs
  base: /docs/
  head:
    - { tag: link, attrs: { rel: apple-touch-icon, href: /icon.png } }
    - { tag: link, attrs: { rel: preconnect, href: //fonts.example } }
    - { tag: meta, attrs: { name: note, content: 'a "quoted" <value>' } }
`)
    expect(html).toContain('<link rel="apple-touch-icon" href="/docs/icon.png">')
    expect(html).toContain('<link rel="preconnect" href="//fonts.example">')
    expect(html).toContain('<meta name="note" content="a &quot;quoted&quot; &lt;value&gt;">')
  })

  it('refuses content that a tag cannot hold, on its line', () => {
    const onMeta = failure(() => load('site:\n  title: Docs\n  head:\n    - tag: meta\n      content: hello\n'))
    expect(onMeta.issues[0]).toMatchObject({ path: ['site', 'head', 0, 'content'], line: 5 })
    expect(onMeta.issues[0]?.message).toContain('<meta> has no content')

    const closing = failure(() =>
      load('site:\n  title: Docs\n  head:\n    - tag: script\n      content: "a()</SCRIPT><p>"\n'),
    )
    expect(closing.issues[0]).toMatchObject({ path: ['site', 'head', 0, 'content'], line: 5 })

    const unknownTag = failure(() => load('site:\n  title: Docs\n  head:\n    - tag: base\n'))
    expect(unknownTag.issues[0]).toMatchObject({ path: ['site', 'head', 0, 'tag'], line: 4 })

    const badName = failure(() => load('site:\n  title: Docs\n  head:\n    - tag: meta\n      attrs: { "on click": x }\n'))
    expect(badName.issues[0]?.path.slice(0, 4)).toEqual(['site', 'head', 0, 'attrs'])
  })
})
