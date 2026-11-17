# Roadmap

Three parts: what is left of putting this project on GitHub and npm, where version 0.1 stands, and what to build
next.

## Part 1: Bootstrap on GitHub

Done so far: the project is its own Git repository, pushed to <https://github.com/hi-manshu/shabd> as a private
repository, with the repository's address filled in where the docs and the package refer to it. Version 0.1.0 is
on npm (step 5).

What is left, in order:

### 1. Watch the first CI run

`.github/workflows/ci.yml` runs on every push and pull request. One job builds, typechecks, runs the unit tests,
checks the docs and builds them with keyword search. A second job runs the browser tests in Chromium, Firefox and
WebKit.

Both run on Ubuntu. Shabd had only been run on macOS before the first push, so expect to fix something. Add
`macos-latest` and `windows-latest` to a matrix after that; file paths are the likely trouble on Windows.

### 2. Decide when to make it public

```sh
gh repo edit hi-manshu/shabd --visibility public --accept-visibility-change-consequences
```

Before that, check `LICENSE` names the copyright holder you want. It says "Shabd contributors".

### 3. Protect `main`

In the repository: **Settings → Rules → Rulesets → New branch ruleset**, targeting `main`:

- Require a pull request before merging
- Require status checks to pass: the `test` and `browsers` jobs

### 4. Publish the documentation

`.github/workflows/docs.yml` builds `docs/` and deploys it to GitHub Pages. It has not been run, and it only starts
by hand until you turn it on:

1. **Settings → Pages → Source: GitHub Actions**
2. In `docs/shabd.config.yaml`, set `site.url` to `https://hi-manshu.github.io` and `site.base` to `/shabd/`
3. In the workflow, add `push: { branches: [main] }` under `on:`

The MCP endpoint will not exist on GitHub Pages, which serves static files only. `llms.txt` and the Markdown copies
will.

### 5. Publish to npm

Done: version 0.1.0 went out on 17 November 2026, and is tagged `v0.1.0`. What follows is how, for the next one.

npm refused the name `shabd` as too similar to `sha1` and `sharp`, and the scope `@shabd` belongs to another
account. So Shabd is published under two names, each with its starter:

| Package | Starter | Start a site with |
| --- | --- | --- |
| `@himanshoe/shabd` | `@himanshoe/create-shabd` | `npm create @himanshoe/shabd@latest my-docs` |
| `shabd-docs` | `create-shabd-docs` | `npm create shabd-docs@latest my-docs` |

`@himanshoe/shabd` is what the package is called in this repository. `shabd-docs` is the same files with the name
changed wherever it is written; `scripts/release/publish.mjs` makes that copy.

```sh
npm login
npm run release -- --dry-run
npm run release
```

The account needs two-factor authentication, and npm asks for it before each package goes out, so run the release
in a terminal of your own. A version that is already on npm is skipped: run it again after a failure and it picks
up where it stopped. A published version cannot be published again, so read what the dry run lists first.

After a release, run both `npm create` commands in an empty folder outside this repository: inside it, npm would
run the local copy. For 0.1.0 both were run that way, and each site installed, passed `shabd check`, built and was
served.

The four pages on npm link to this repository, which nobody else can open while it is private.

After the first release, switch to trusted publishing so no token is stored: on npmjs.com, open the package's
settings, add a trusted publisher for this repository, and publish from a workflow that runs on version tags with
`id-token: write` permission and `npm publish -w packages/shabd --provenance --access public`.

### 6. Add the community files

`CONTRIBUTING.md` is written. Still to add:

- `SECURITY.md`, with a private way to report vulnerabilities. This matters here: the dev server can write files.
- `CODE_OF_CONDUCT.md`
- Issue forms and a pull request template under `.github/`
- A changelog. [Changesets](https://github.com/changesets/changesets) suits a monorepo with one published package.

## Part 2: Where 0.1 stands

| Area | State |
| --- | --- |
| YAML config, sidebar and frontmatter: schemas, loader, source-mapped errors | Built, tested |
| Sidebar resolver with automatic fallback | Built, tested |
| Layout engine: regions, blocks, `extends`, per-page switches, custom blocks | Built, tested in three browser engines |
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

"Three browser engines" means the Chromium, Firefox and WebKit builds that Playwright drives, on macOS. It does not
mean Chrome, Firefox and Safari as people install them, and it does not cover Linux or Windows.

### What has been checked

On one machine (macOS 26, Node 22.16), with the docs site and a small test site in this repository:

- 226 unit and integration tests pass. They cover config and sidebar validation, the sidebar resolver, the Markdown
  pipeline, layout resolution, the theme presets and their contrast, search ranking, both search stores, the
  content store, the starter, and the MCP endpoint driven by the official MCP client.
- 116 browser tests pass in Playwright's Chromium, Firefox and WebKit: prerendered pages with and without
  JavaScript, hydration, navigation, every layout, the sidebar, search, the theme menu, text contrast on every
  theme's rendered page, sandboxes, hot updates of pages and YAML, the Studio including conflicts and its folder
  backend, and two editors connecting peer to peer. Sixteen more are skipped where an engine lacks what they need.
- The search tests also pass with the index held in SQLite, and semantic search with the real embedding model
  finds a section by meaning in all three engines on both stores.
- Version 0.1.0 was installed from npm into an empty folder under both names. Each site passed `shabd check`,
  built and was served.
- The 18-page docs site builds in about 2 seconds with embeddings, and in about 1 second when they are cached.
- A saved edit to a page reached the DOM in a median of 42 ms (10 saves, 35 to 49 ms after the first, which took
  116 ms). That was measured in Chromium for the first commit, and not again since.

On GitHub's Linux machines the unit tests pass. Two browser tests fail there: the error overlay clearing after a
mistake in the YAML is fixed, and two editors connecting peer to peer.

Not yet checked:

- Chrome, Firefox and Safari as people install them, and Windows.
- The system folder picker in the Studio. Its code runs in the tests against real file handles, but the picker
  itself needs a person.
- Peer editing between two machines on different networks.
- The MCP handler on a serverless or edge host.
- Sites with thousands of real pages.

## Part 3: What comes next

### 0.2: Make what exists dependable

- Run the browser tests on Linux and Windows. The CI workflow has a job for Linux that has never run.
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
