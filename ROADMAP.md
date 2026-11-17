# Roadmap

Three parts: where the project lives and what is left to set up there, where version 0.1 stands, and what to build
next.

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
- 122 browser tests pass in Playwright's Chromium, Firefox and WebKit: prerendered pages with and without
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
only there: 120 pass and 18 are skipped. Playwright's Firefox and WebKit connected two pages on Linux only some of
the time. The suite then runs again on the SQLite search store, where 129 pass.

On the deployed docs site, on 17 November 2026, in Chromium: all 18 pages open with nothing in the console, the 36
links between them lead somewhere, and each of these worked when tried as a reader would: search by keyword and
by meaning, the theme menu's 23 presets and code that follows them, light and dark mode, the copy button, tabs,
cards and callouts, a custom component, the live sandboxes, the outline, previous and next, the edit link, the
files for AI agents, the sitemap, the 404 page, and the phone-size layout.

Not yet checked:

- Chrome, Firefox and Safari as people install them, and Windows.
- The system folder picker in the Studio. Its code runs in the tests against real file handles, but the picker
  itself needs a person.
- Peer editing between two machines on different networks.
- The MCP handler on a serverless or edge host.
- Sites with thousands of real pages.

## Part 3: What comes next

### 0.2: Make what exists dependable

- Run the tests on Windows and macOS on GitHub. They run on Linux there today.
- On Linux, a file saved twice within 50 ms is seen once: the dev server's file watcher drops the second change.
  An editor that saves in two writes could leave the server one save behind. Reading the file again a moment
  after each change would close that. It was found because a test did exactly this.
- A setting for the colour of the header's text, so that a theme can have a dark header. The Windows XP theme
  would use it for a blue taskbar.
- Run the browser tests on a phone-size screen with a long sidebar and on real page lengths. Two faults on the
  docs site were found only by walking the deployed site: a sidebar longer than the screen sat under the header,
  and the Studio's footer missed a page update that arrived before the save was confirmed. The test site was too
  small and too slow to show either.
- Try the real browsers by hand, Safari above all. WebKit under test did not offer its private file system to the
  search worker; whether Safari does needs checking.
- Peer editing between two machines on different networks.
- An accessibility pass: the sidebar panel on small screens, the search dialog, tabs.
- A benchmark with 1,000 and 5,000 real pages: startup, build time, index size. The design scans and holds every
  page in memory, which is fine for hundreds and unmeasured beyond. The search stores have been measured on their
  own, up to 20,000 synthetic sections.
- Frosted panels in real browsers. The Firefox and WebKit builds the tests drive do not blur what is behind a
  translucent header or sidebar; Chromium does. The themes are readable either way, which the contrast test
  checks, but whether Firefox and Safari as people install them blur it has not been looked at.
- The logo's animation under "Reduce motion" in Safari. It was checked in Chromium and Firefox.
- Lighter pages on a site with a theme menu. Each page carries the colours of its own code for every syntax theme
  the menu can reach, in its HTML and again in its script. On the docs site, which offers all 23 presets, that is
  about 39 KB in each on the page with the most code. The themes a reader has to pick could live in one shared
  stylesheet, fetched when one is picked; for the docs site it would be an estimated 78 KB, fetched once.
- Type declarations for `shabd/client`. It ships as TypeScript source today, which a site's own type check cannot
  follow into the generated `virtual:` modules.
- Keep React Fast Refresh working while editing the theme's own source. A few client modules export both components
  and helpers, which forces a page reload when they change. This affects contributors, not site authors.

### 0.3: Finish the four headline features

**Search**

- Serve the embedding model from the site, so nothing is fetched from Hugging Face.
- In the SQLite store, compare vectors outside SQL. Semantic queries took 72 ms at 20,000 sections against 19 ms in
  the memory store, because each row crosses from SQLite into JavaScript.
- Word segmentation for Chinese, Japanese and Thai keyword search.

**MCP**

- Adapters for Cloudflare, Vercel and Netlify, written by `shabd build --adapter <name>`.
- Semantic search behind the endpoint where the host can afford the model.

**Studio**

- A real code editor in place of the text area.
- Create, rename and delete pages. Paste images.
- A CRDT (Yjs) for drafts, so two people can type at once. Today the newest draft replaces the other.
- Signalling that does not need two codes pasted by hand.

**Sandboxes**

- Syntax colours in the editor.
- An option to run a snippet in an isolated frame.
- More modules to import, declared in the config.

### Later

- Translations and versioned docs
- More than one sidebar, chosen by section
- `trailingSlash` and `.html` output options
- Conditions on layout blocks, and a two-column `api` layout with prose beside code
- Pages generated from an OpenAPI file
- Remark and rehype plugins named in YAML
- "Last updated" from Git history, an RSS feed, social images

### 1.0

The config schema stops changing without a migration note. Until then, expect keys to move.
