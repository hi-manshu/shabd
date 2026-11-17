import { describe, expect, it } from 'vitest'
import { renderDocument, renderRedirect } from '../src/node/build/html.js'
import { collectProblems } from '../src/node/check.js'
import { resolveConfig } from '../src/node/config/load.js'
import { createContext } from '../src/node/context.js'
import { failure, temporarySites } from './helpers/site.js'

const load = (yaml: string) => resolveConfig('/site', '/site/shabd.config.yaml', yaml)
const site = temporarySites()

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

describe('redirects', () => {
  it('follows a chain to its end, so a reader is sent on once', () => {
    const { redirects } = load(`
site:
  title: Docs
redirects:
  /first: /second
  /second/: /third#part
  /elsewhere.html: https://example.com/docs
`)
    expect(redirects).toEqual([
      { key: '/first', from: '/first', to: '/third#part', external: false },
      { key: '/second/', from: '/second', to: '/third#part', external: false },
      { key: '/elsewhere.html', from: '/elsewhere', to: 'https://example.com/docs', external: true },
    ])
  })

  it('refuses redirects that lead in a circle, or that start from one address twice', () => {
    const circle = failure(() => load('site:\n  title: Docs\nredirects:\n  /a: /b\n  /b: /a\n'))
    expect(circle.issues[0]).toMatchObject({ path: ['redirects', '/a'], line: 4 })
    expect(circle.issues[0]?.message).toBe('Redirects lead in a circle: /a → /b → /a')

    const twice = failure(() => load('site:\n  title: Docs\nredirects:\n  /a: /b\n  /a/: /c\n'))
    expect(twice.issues[0]).toMatchObject({ path: ['redirects', '/a/'], line: 5 })
  })

  it('says what a redirect may start from and lead to', () => {
    const source = failure(() => load('site:\n  title: Docs\nredirects:\n  old-page: /new\n'))
    expect(source.issues[0]).toMatchObject({ path: ['redirects', 'old-page'], line: 4, column: 3 })
    expect(source.issues[0]?.message).toContain('A redirect starts from a path on this site')

    const target = failure(() => load('site:\n  title: Docs\nredirects:\n  /old: new-page\n'))
    expect(target.issues[0]).toMatchObject({ path: ['redirects', '/old'], line: 4 })
    expect(target.issues[0]?.message).toContain('A redirect leads to a path on this site')
  })

  it('writes a page that sends the reader on, with and without scripts', () => {
    const { config } = load('site:\n  title: Docs\n  url: https://docs.example\n')
    const html = renderRedirect(config, '/docs/guide/install')
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=/docs/guide/install">')
    expect(html).toContain('<link rel="canonical" href="https://docs.example/docs/guide/install">')
    expect(html).toContain('<meta name="robots" content="noindex">')
    expect(html).toContain('<a href="/docs/guide/install">')
    // The heading the reader asked for is kept, unless the redirect names its own.
    expect(html).toContain('location.replace("/docs/guide/install" + location.hash)')
    expect(renderRedirect(config, '/guide#start')).toContain('location.replace("/guide#start")')

    const away = renderRedirect(config, 'https://example.com/a?b=1&c=</script>')
    expect(away).toContain('<link rel="canonical" href="https://example.com/a?b=1&amp;c=&lt;/script&gt;">')
    expect(away).not.toContain('</script>"')
  })

  it('reports a redirect that a page stands on, one that leads nowhere, and a link that takes the detour', async () => {
    const dir = await site({
      'shabd.config.yaml': `site:
  title: Docs
redirects:
  /guide/old: /guide/install#steps
  /guide/setup: /guide/install
  /gone: /nowhere
  /lost: /guide/install#no-such-heading
`,
      'content/guide/install.md': '# Install\n\n## Steps\n\nSee [the old page](/guide/old).\n',
      'content/guide/setup.md': '# Setup\n',
    })
    const { problems } = await collectProblems(await createContext(dir, { dev: false }))
    expect(problems.map(({ level, file, line, message }) => `${level} ${file}:${line ?? ''} ${message}`)).toEqual([
      'warning content/guide/install.md: Link to /guide/old, which has moved to /guide/install#steps. Link there instead.',
      'error shabd.config.yaml:5 Redirect from /guide/setup: a page has that address, so the redirect is never used. Remove one of them.',
      'error shabd.config.yaml:6 Redirect from /gone leads to /nowhere, where there is no page',
      'error shabd.config.yaml:7 Redirect from /lost leads to /guide/install, which has no heading "#no-such-heading"',
    ])
  })
})
