# Roadmap

Four parts: where the project lives and what is left to set up there, where version 0.1 stands, what has been
built since on a branch, and what to build next.

## Part 1: Where the project lives

| | State |
| --- | --- |
| Repository | Public, at <https://github.com/hi-manshu/shabd>, under the MIT licence |
| Tests on GitHub | `ci.yml` runs on every push and pull request, on Linux: one job builds, typechecks and runs the unit tests, another runs the browser tests in Chromium, Firefox and WebKit. First green on 17 November 2026 |
| Documentation | <https://hi-manshu.github.io/shabd/>, on GitHub Pages. `docs.yml` deploys it again whenever `main` changes |
| npm | Version 0.1.0, published on 17 November 2026 and tagged `v0.1.0`, under two names (below) |
| Releases | `release.yml`, started by hand with a version, by the repository's owner only. It has been run as a dry run; no release has gone out through it yet. `npm run release` does the same from a machine |

npm refused the name `shabd` as too similar to `sha1` and `sharp`, and the scope `@shabd` belongs to another
account. So Shabd is published under two names, each with its starter:

| Package | Starter | Start a site with |
| --- | --- | --- |
| `@himanshoe/shabd` | `@himanshoe/create-shabd` | `npm create @himanshoe/shabd@latest my-docs` |
| `shabd-docs` | `create-shabd-docs` | `npm create shabd-docs@latest my-docs` |

`@himanshoe/shabd` is what the package is called in this repository. `shabd-docs` is the same files with the name
changed wherever it is written; `scripts/release/publish.mjs` makes that copy. [CONTRIBUTING.md](./CONTRIBUTING.md)
says how to release, under "Releasing".

What is left to set up:

1. **Trusted publishers on npm**, before the first release from GitHub. Each of the four packages has to name
   `release.yml` as a trusted publisher. npm drops one that has not published within two days, so add them when a
   release is due.
2. **Protect `main`.** In the repository: Settings → Rules → Rulesets → New branch ruleset, targeting `main`, with
   the `test` and `browsers` jobs required. The release workflow pushes the commit that sets the version straight
   to `main`: if pull requests become required, let the owner bypass that, or release from a machine.
3. **Tests on macOS and Windows.** `ci.yml` runs on Linux only. File paths are the likely trouble on Windows.
4. **The copyright holder.** `LICENSE` says "Shabd contributors". Check that this is the name you want.
5. **Community files:** `SECURITY.md` with a private way to report vulnerabilities, which matters here because the
   dev server can write files; `CODE_OF_CONDUCT.md`; issue forms and a pull request template; a changelog.
6. **A host for the MCP endpoint.** GitHub Pages serves files only, so `/mcp` answers 405 there. `llms.txt` and
   the Markdown copy of each page are served.

## Part 2: Where 0.1 stands

| Area | State |
| --- | --- |
| YAML config, sidebar and frontmatter: schemas, loader, source-mapped errors | Built, tested |
| Sidebar resolver with automatic fallback | Built, tested |
| Layout engine: regions, blocks, `extends`, per-page switches, custom blocks | Built, tested in three browser engines, down to a phone-size screen with a banner above the header |
| Markdown/MDX pipeline, compile cache | Built, tested |
| Dev server with hot updates for pages and YAML | Built, tested in three browser engines |
| Static build, prerendering, hydration | Built, tested in three browser engines |
| Keyword and semantic search | Built, tested in three browser engines with the real model |
| SQLite search store (FTS5, kept in the browser's private file system) | Built, tested. WebKit under test fell back to memory |
| `llms.txt`, Markdown copies | Built, tested |
| MCP: dev route, `shabd preview`, stdio | Built; protocol tested with the official client |
| MCP on a serverless host | Handler exported; no adapter, not tested on a host |
| Studio: dev-server saving, tab sync, conflicts | Built, tested in three browser engines |
| Studio: folder saving (File System Access API) | Built, tested in Chromium against real file handles; the system folder picker itself needs a person |
| Studio: peer editing over WebRTC | Built, tested between two browser sessions on one machine; not across networks |
| Live sandboxes | Built, tested in three browser engines |
| Themes: 23 presets, the reader's menu, code colours that follow the chosen preset | Built, tested in three browser engines |
| Readable code: every syntax colour at 4.5:1 or more against what is behind it | Built, tested for all 23 presets in both modes on a sample of code in eight languages |
| Contrast of every preset | Tested: colour against colour for all 23, and text against every pixel of the rendered page for the ten themes, in three browser engines |
| The starter, under both names | Built, tested, published. Both `npm create` commands were run from the registry: each site installed, passed `shabd check`, built and was served |
| A site served from a sub-path, as GitHub Pages serves one | Built. Checked on the deployed docs: every page, the links between them, search, the theme menu, the 404 page |

"Three browser engines" means the Chromium, Firefox and WebKit builds that Playwright drives, on macOS and, on
GitHub, on Linux. It does not mean Chrome, Firefox and Safari as people install them, and it does not cover
Windows.

### What has been checked

On one machine (macOS 26, Node 22.16), with the docs site and a small test site in this repository:

- 227 unit and integration tests pass. They cover config and sidebar validation, the sidebar resolver, the Markdown
  pipeline, layout resolution, the theme presets and their contrast, search ranking, both search stores, the
  content store, the starter, and the MCP endpoint driven by the official MCP client.
- 119 browser tests pass in Playwright's Chromium, Firefox and WebKit: prerendered pages with and without
  JavaScript, hydration, navigation, every layout, the sidebar, the phone-size layout, search, the theme menu, text
  contrast on every theme's rendered page, sandboxes, hot updates of pages and YAML, the Studio including conflicts
  and its folder backend, and two editors connecting peer to peer. Sixteen more are skipped where an engine lacks
  what they need.
- The search tests also pass with the index held in SQLite, and semantic search with the real embedding model
  finds a section by meaning in all three engines on both stores.
- Version 0.1.0 was installed from npm into an empty folder under both names. Each site passed `shabd check`,
  built and was served.
- The 18-page docs site builds in about 2 seconds with embeddings, and in about 1 second when they are cached.
- A saved edit to a page reached the DOM in a median of 42 ms (10 saves, 35 to 49 ms after the first, which took
  116 ms). That was measured in Chromium for the first commit, and not again since.

On GitHub's Linux machines the same tests pass, except that two editors connecting peer to peer runs in Chromium
only there. Playwright's Firefox and WebKit connected two pages on Linux only some of the time.

On the deployed docs site, on 17 November 2026, in Chromium: all 18 pages open with nothing in the console, the 36
links between them lead somewhere, and each of these worked when tried as a reader would: search by keyword and
by meaning, the theme menu's 23 presets and code that follows them, light and dark mode, the copy button, tabs,
cards and callouts, a custom component, the live sandboxes, the outline, previous and next, the edit link, the
files for AI agents, the sitemap, the 404 page, and the phone-size layout.

Not yet checked:

- Chrome, Firefox and Safari as people install them, and Windows.
- The system folder picker in the Studio. Its code runs in the tests against real file handles, but the picker
  itself needs a person.
- Peer editing between two machines: on one network by the link, and on different networks by the codes.
- The MCP handler on a serverless or edge host.
- Sites with thousands of real pages.

## Part 3: Built since 0.1, on a branch

Everything in this part is on the branch `worktree-feature-buildout`. None of it is released, none of it is on
`main`, and nothing was pushed. Each row was committed when its tests passed on one machine (macOS 26, Node 22.16).
GitHub's machines have not run any of it.

| Area | State |
| --- | --- |
| API pages: a form that sends the request ("Try it") | Built, tested in three browser engines |
| Pages made from an OpenAPI description (`openapi:`) | Built, tested in three browser engines. The docs describe their own files this way |
| Search: the passage a result was found in, words typed nearly right, and Chinese, Japanese and Thai by keyword | Built, tested |
| Search: vectors compared outside SQL in the SQLite store, and the embedding model served by the site | Built, tested with the real model |
| MCP: adapters for Cloudflare, Vercel and Netlify, written by `shabd build --adapter <name>` | Built, with unit tests of what each writes. Not deployed to any of the three |
| MCP: search by meaning behind `shabd preview`, the dev route and stdio | Built, tested |
| A header with ink of its own (`theme.headerText`), which the Windows XP preset uses for a blue bar | Built, tested in three browser engines |
| Type declarations for `shabd/client` | Built. A site's own type check follows them |
| Lighter pages on a site with a theme menu | Built. The colours of code under the themes a reader has to pick are in one stylesheet, fetched when one is picked. On the docs site the page with the most code went from 98 KB of HTML to 61 KB |
| A second look at a file that is saved twice in quick succession | Built, tested on macOS. The fault it answers was seen on Linux, where it has not been run |
| Accessibility: a pass with a checker (axe) and with the keyboard | Built into the browser tests, with what it found fixed. See below |
| Reading a built site offline (`features.offline`) | Built, tested in three browser engines; without a connection in Chromium and WebKit only |
| `shabd dev` on a site with a base | Mended. Such a site showed an empty page: it had done so since the first commit. A test now starts the dev server on one |
| Studio: a code editor, making, renaming and deleting pages, and pasted images | Built, tested in three browser engines |
| Sandboxes: modules named in the config, a frame of its own for a snippet, colours in the editor | Built, tested in three browser engines |
| `shabd check`: a live snippet that cannot run, or that imports what the site has not named | Built, tested |
| Fast Refresh while the theme's own source is edited | Built. A component is in a file of its own, and a test holds the client to that. Tried by hand in Chromium: a change to a link, an icon, a hook or the router's provider is taken in place and the page keeps its state. A change to the router's own file still starts the page again, because the app's entry imports it |
| Versions of the docs (`versions:`) and languages of the site (`languages:`) | Built, tested in three browser engines, one of the languages written from right to left. Each is a folder of the content, with a sidebar and a search of its own, and a menu leads to the same page in the others. A language can say the site's own words, the header's links and the footer in its own way. What stays as it is written is under "Not checked" below |
| Studio: drafts that merge (Yjs). Two people type in one page at the same moment and both keep what they typed | Built, tested between two tabs in three browser engines and between two browser sessions on one machine. Not tried between two machines |
| Studio: an invitation by link. The dev server holds the two notes the browsers need, where two codes were pasted by hand | Built, tested between two browser sessions on one dev server, in three engines. Not opened from a second machine. The codes remain for a machine that cannot reach the dev server |
| Studio: a tab where a theme's colours are tried beside the page, with their contrast, and written to the config | Built, tested in three browser engines. Only the lines that say the change are written. Colours and the preset, not fonts or sizes |
| A benchmark for large sites (`npm run bench`) | Built. Its numbers are below |

### What the accessibility pass found

All of it is fixed, and each has a test:

- A badge's word had too little contrast with the tint behind it, in 74 places across the presets.
- The search dialog: its field had no name, the number of results was not announced, and focus was lost when the
  dialog closed.
- Tabs did not answer Home and End, and a panel could not be reached with Tab.
- On a small screen, what was under the open sidebar panel could still be reached with the keyboard, and Escape
  did not close the panel.
- The wrapper that lets a wide table scroll sideways had no role.
- The frame of an isolated snippet had no colour of its own behind its text.

It was a checker and a keyboard. Nobody has listened to the site with a screen reader.

### Numbers from the benchmark

On an Apple M2 Pro with 10 cores and 16 GB, Node 22.16, while other work was running on the machine. The made-up
sites are `npm run bench`; the third column is 5,001 pages of MDN's content.

| | 1,000 pages, made up | 5,000 pages, made up | 5,001 pages of MDN |
| --- | --- | --- | --- |
| Words | 848,000 | 4.3 million | 3.6 million |
| Build | 16 s, 1.4 GB of memory | 128 s, 2.7 GB | 154 s, 3.8 GB |
| Search index | 5.8 MB (1.1 MB compressed), 7,275 sections | 29.6 MB (5.7 MB), 37,089 sections | 30.4 MB (6.2 MB), 51,024 sections |
| A build with nothing changed | 5.7 s | 50 to 65 s | 66 s |
| `shabd check` | 0.36 s | 2.2 s | 3.0 s |
| Dev server listening | 0.18 s | 0.52 s | 1.2 s |
| A saved edit on screen | 43 ms | about 80 ms | not measured |
| The first search, then each one after | 0.84 s, then 27 ms | 2.1 s, then 30 ms | not measured |

The benchmark found faults that are fixed. The sidebars took time that grew with the square of the number of
pages. The list of pages was made again each time it was asked for. And a folder that holds only its own index
page became a group of one in the sidebar: on MDN's layout, where every page is such a folder, that made the HTML
of 1,001 pages 224 MB, and it is 71 MB now. At 5,000 pages `shabd check` went from 6.7 s to 2.2 s, and the dev
server listens after 0.52 s where it took 5.2 s.

It also found that pages were compiled on one core: about 59 s of the 128 at 5,000 pages. A site of a few hundred
pages or more now has them compiled on up to eight threads (`build.threads`). `shabd check` on 2,000 made-up pages,
from an empty cache, took 21.8 s on one thread and 6.8 s on eight. The table above is from before that.

It found that every reader was sent the data of the whole site: at 5,000 pages, 2.5 MB (436 KB compressed) in one
chunk of the first script. That chunk is now 0.92 MB (157 KB compressed). The table of every page, with its file
and its description, is no longer in it: a page brings its own, and the dev server keeps the table for the Studio.
And the routes no longer carry a list of what to fetch with each page. With both changes, the 5,000-page site
built in 64 s where it took 128 s, on the same machine with less else running.

What it found that is not fixed:

- That chunk still holds the whole sidebar and a route for every page, which is why it grows with the site: about
  450 KB and 375 KB of it at 5,000 pages.
- The bundler's time grows faster than the number of pages, and most of the memory is the bundler's.

### What has been checked, and what has not

- 775 unit and integration tests pass.
- 472 browser tests pass in Playwright's Chromium, Firefox and WebKit. 41 more are skipped: where an engine lacks
  what a test needs, and the tests that belong to a variation that was not switched on for that run. That run
  was made just before two small changes: a mend to the Theme tab, and the one that makes search run once. The
  tests of the Theme tab, of the Studio's editor and of search were run again after them, in all three engines.
- The four variations of the browser tests were run once the Theme tab was finished. The whole suite with the
  search index in SQLite: 480 pass, 32 are skipped and one failed, where a test pressed an arrow key before a
  search had answered. Search was running twice on a site with versions or languages. It runs once now, and
  that test and the other tests of search then passed three times over in each engine, on SQLite. Semantic
  search with the real embedding model: 6 pass, 6 skipped. The same with the model served by the site: 12 pass.
  Reading offline: 10 pass, 2 skipped in Firefox.
- The docs site builds and passes `shabd check` with every feature above switched on that it can use.

Not checked:

- Everything under "Not yet checked" in Part 2, except sites with thousands of pages.
- The three adapters on their hosts.
- The second look at a file, on Linux.
- Reading offline in Firefox without a connection. The Firefox that the tests drive leaves a service worker its
  connection, so the two tests that cut it are skipped there.
- Hot updates of the theme's own source in Firefox and WebKit. They were tried in Chromium. A hot update cannot
  hand out a second copy of one of the app's stores: none of them stands above a component's file, and a test
  reads what every file of the client imports to keep it so.
- Versions and languages. Search within one asks for more results than it shows and leaves out those from
  elsewhere, so a query can come back short where versions differ a great deal. The MCP endpoint searches every
  version and every language. The site's title, the words of an API reference and those of a live example are
  the same in every language. And a page written from right to left has been held to two things by a test, the
  sidebar on the other side and nothing wider than the window: nobody who reads such a language has looked at one.
- In the Studio, between two machines: drafts that merge, and the link that invites. Both were tried between two
  browser sessions on one machine, on one dev server. With more than two editors on a page the merging is tested
  without a browser.
- A site's own `content/404.md`. A build writes it into `404.html`, and from reading the code the built-in page
  takes its place as soon as the page's script runs. That was so before this branch, and has not been looked at
  in a browser.
- Beside the open Studio, a page on a screen narrower than about 1,500 pixels: its text is squeezed between the
  sidebar and the outline. That was so before this branch too.
- In the Studio: an image is not moved, renamed or deleted with its page; pasting and dropping are tested with
  events the test makes, not with the real clipboard or a real drag; and while a page is renamed its breadcrumbs
  and its mark in the sidebar are gone for as long as the next page takes to draw.

## Part 4: What comes next

### 0.2: Make what exists dependable

- Run the tests on Windows and macOS on GitHub. They run on Linux there today.
- Run this branch's tests on GitHub at all, and the second look at a file on Linux.
- Try the real browsers by hand, Safari above all. WebKit under test did not offer its private file system to the
  search worker; whether Safari does needs checking. So do frosted panels in Firefox and Safari as people install
  them, and the logo's animation under "Reduce motion" in Safari.
- Peer editing between two machines on different networks.
- The adapters for Cloudflare, Vercel and Netlify, each on its host.
- Listen to the site with a screen reader.
- From the benchmark: send a reader the sidebar of the part of the site they are in, and the routes as they are
  needed. Both are still whole in the first script.

### 0.3: Finish the four headline features

Search, MCP and the sandboxes have what was listed for them. In the Studio, drafts merge and an invitation is a
link. What is left:

- An invitation that works between two networks with nothing set up. The link leads to the dev server of the one
  who invites, so it is for the same machine or the same network: across networks it is still two codes.
- In a shared draft: where the other person's cursor is.

### Later

- In the Theme tab: the rest of a theme's tokens. It tries colours and the preset today.

The rest of what stood here is built: a place to try a theme's colours and see their contrast, versioned docs and
translations, more than one sidebar chosen by section, addresses with a trailing slash or
`.html`, conditions on layout blocks and a two-column `api` layout, pages made from an OpenAPI file, remark and
rehype plugins named in YAML, and "last updated" from Git history, an RSS feed and social pictures.

### 1.0

The config schema stops changing without a migration note. Until then, expect keys to move.
