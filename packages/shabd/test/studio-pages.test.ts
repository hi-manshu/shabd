import { describe, expect, it } from 'vitest'
import {
  newPageSource,
  pageIdProblem,
  removeFromSidebar,
  renameInSidebar,
  sidebarMentions,
  titleFromId,
} from '../src/node/vite/studio-pages.js'

const SIDEBAR = `# The navigation.
- category: Guide
  items:
    - guide/intro   # the first page
    - file: guide/setup
      badge: New
    - folder: More
      collapsed: true
      items:
        - "guide/wide.md"
        - /guide/hosting
- category: Play
  items:
    - play/sandbox
- link: https://example.com
  label: Elsewhere
`

describe('paths the Studio may create', () => {
  it('accepts a Markdown or MDX file inside the content folder', () => {
    for (const id of ['index.md', 'guide/new-page.md', 'api/v2/list_users.mdx', 'a.b/c-d.md']) expect(pageIdProblem(id), id).toBeUndefined()
  })

  it('refuses whatever is not a page, or not inside the folder', () => {
    const refused = ['', '   ', 5, undefined, '/etc/passwd.md', '../outside.md', 'guide/../../x.md', 'guide//x.md', 'guide/x.txt', 'guide/x', 'guide\\x.md', '_drafts/x.md', 'guide/.hidden.md', 'guide/has space.md', 'guide/é.md', `${'a'.repeat(201)}.md`]
    for (const id of refused) expect(pageIdProblem(id), String(id)).toEqual(expect.any(String))
    expect(pageIdProblem('../outside.md')).toMatch(/inside the content folder/)
    expect(pageIdProblem('_drafts/x.md')).toMatch(/not pages/)
    expect(pageIdProblem('guide/x.txt')).toMatch(/\.md or \.mdx/)
  })

  it('starts a new page with a title taken from its file name', () => {
    expect(titleFromId('guide/new-page.md')).toBe('New page')
    expect(titleFromId('guide/index.mdx')).toBe('Guide')
    expect(titleFromId('index.md')).toBe('Home')
    expect(newPageSource('guide/new-page.md')).toBe('---\ntitle: "New page"\n---\n\nWrite the page here.\n')
    expect(newPageSource('x.md', 'Say "hi": now')).toContain('title: "Say \\"hi\\": now"')
  })
})

describe('the sidebar file follows a page', () => {
  it('knows which pages it names, however they are written', () => {
    for (const id of ['guide/intro.md', 'guide/setup.md', 'guide/wide.md', 'guide/hosting.md', 'play/sandbox.mdx']) {
      expect(sidebarMentions(SIDEBAR, id), id).toBe(true)
    }
    expect(sidebarMentions(SIDEBAR, 'guide/other.md')).toBe(false)
    expect(sidebarMentions('not: [valid', 'guide/intro.md')).toBe(false)
  })

  it('points a renamed page\'s entries at its new path, and changes nothing else', () => {
    const changed = (from: string, to: string) => {
      const after = renameInSidebar(SIDEBAR, from, to).split('\n')
      return SIDEBAR.split('\n').flatMap((line, index) => (line === after[index] ? [] : [[line, after[index]]]))
    }
    expect(changed('guide/intro.md', 'start/welcome.md')).toEqual([['    - guide/intro   # the first page', '    - start/welcome   # the first page']])
    expect(changed('guide/setup.md', 'guide/install.mdx')).toEqual([['    - file: guide/setup', '    - file: guide/install']])
    // Written with quotes and an extension: it keeps both.
    expect(changed('guide/wide.md', 'guide/broad.md')).toEqual([['        - "guide/wide.md"', '        - "guide/broad.md"']])
    // Written with a leading slash: it keeps that.
    expect(changed('guide/hosting.md', 'ops/live.md')).toEqual([['        - /guide/hosting', '        - /ops/live']])
    // An index page is named by its folder.
    expect(changed('play/sandbox.mdx', 'play/index.mdx')).toEqual([['    - play/sandbox', '    - play']])
    expect(renameInSidebar(SIDEBAR, 'guide/other.md', 'x.md')).toBe(SIDEBAR)
  })

  it('takes out the entry of a deleted page where that is safe', () => {
    expect(removeFromSidebar(SIDEBAR, 'guide/intro.md')).toBe(SIDEBAR.replace('    - guide/intro   # the first page\n', ''))
    // The long form goes with all its lines.
    expect(removeFromSidebar(SIDEBAR, 'guide/setup.md')).toBe(SIDEBAR.replace('    - file: guide/setup\n      badge: New\n', ''))
    expect(removeFromSidebar(SIDEBAR, 'guide/hosting.md')).toBe(SIDEBAR.replace('        - /guide/hosting\n', ''))
    // The only entry of its group stays: a group with nothing in it is not a valid sidebar.
    expect(removeFromSidebar(SIDEBAR, 'play/sandbox.mdx')).toBe(SIDEBAR)
    // A list written on one line is left alone.
    const flow = '- category: Guide\n  items: [guide/intro, guide/setup]\n'
    expect(removeFromSidebar(flow, 'guide/intro.md')).toBe(flow)
  })
})
